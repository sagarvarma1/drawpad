"use client";

import { useEffect, useRef, useState } from "react";

const newId = () =>
  Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);

export function Drawpad({
  width,
  height,
  colors,
  background,
  eraser,
  sizes,
  deployment,
}) {
  const canvasRef = useRef(null);
  /** Every stroke we know about, by id: { c, s, pts }. */
  const strokes = useRef(new Map());
  /** Strokes drawn on this screen; their echoes from the server are already on the canvas. */
  const mine = useRef(new Set());
  const current = useRef(null);
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(1);
  const [online, setOnline] = useState(null);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const styleFor = (c) => (c === eraser ? background : colors[c]);

  /** Draws points [from..] of a stroke; `from` is the index of the first new x. */
  function render(stroke, from = 0) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || stroke.pts.length < 2) return;
    ctx.strokeStyle = styleFor(stroke.c);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = sizes[stroke.s];
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const p = stroke.pts;
    const start = Math.max(0, from - 2);
    if (p.length - start === 2) {
      // A single point: a dot.
      ctx.beginPath();
      ctx.arc(p[start], p[start + 1], sizes[stroke.s] / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(p[start], p[start + 1]);
    for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    for (const stroke of strokes.current.values()) render(stroke);
  }

  // Sharp at any size: the canvas backing store follows its on-screen size and pixel density.
  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      redraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "full") return source.close();
      setConnected(true);
      setOnline(event.online);
      if (event.type === "hello") {
        // Keep anything we're drawing right now; replace the rest with the server's copy.
        const kept = [...mine.current]
          .filter((id) => id === current.current?.id)
          .map((id) => [id, strokes.current.get(id)]);
        strokes.current = new Map(
          event.strokes.map((s) => [s.id, { c: s.c, s: s.s, pts: s.pts }]),
        );
        for (const [id, s] of kept) if (s) strokes.current.set(id, s);
        redraw();
      } else if (event.type === "clear") {
        strokes.current.clear();
        redraw();
      } else if (event.type === "draw") {
        let removed = false;
        for (const chunk of event.chunks) {
          if (chunk.removed) {
            removed = strokes.current.delete(chunk.id) || removed;
            continue;
          }
          if (mine.current.has(chunk.id)) continue;
          let stroke = strokes.current.get(chunk.id);
          if (!stroke) {
            stroke = { c: chunk.c, s: chunk.s, pts: [] };
            strokes.current.set(chunk.id, stroke);
          }
          const from = stroke.pts.length;
          stroke.pts.push(...chunk.pts);
          if (!removed) render(stroke, from);
        }
        if (removed) redraw();
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flash(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * height);
    return [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
  }

  /**
   * Sends what's been drawn since the last send (every 50ms while drawing). Pieces of a stroke go
   * one at a time, so they reach the server, and everyone else, in order.
   */
  function send(stroke) {
    if (!stroke.unsent.length || stroke.dead) return;
    const pts = stroke.unsent;
    stroke.unsent = [];
    stroke.queue = (stroke.queue ?? Promise.resolve()).then(() =>
      post(stroke, pts),
    );
  }

  async function post(stroke, pts) {
    if (stroke.dead) return;
    try {
      const res = await fetch("/api/stroke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: stroke.id, c: stroke.c, s: stroke.s, pts }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error ??
            "Couldn't save that line",
        );
    } catch (err) {
      // The server didn't take it, so nobody else sees it: take it off this screen too.
      strokes.current.delete(stroke.id);
      mine.current.delete(stroke.id);
      stroke.dead = true;
      redraw();
      flash(err.message);
    }
  }

  function down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured; drawing still works.
    }
    const [x, y] = point(e);
    const stroke = {
      id: newId(),
      c: color,
      s: size,
      pts: [x, y],
      unsent: [x, y],
      dead: false,
    };
    current.current = stroke;
    mine.current.add(stroke.id);
    strokes.current.set(stroke.id, stroke);
    render(stroke);
    stroke.timer = setInterval(() => send(stroke), 50);
  }

  function move(e) {
    const stroke = current.current;
    if (!stroke || stroke.dead) return;
    const [x, y] = point(e);
    const n = stroke.pts.length;
    if (Math.abs(stroke.pts[n - 2] - x) + Math.abs(stroke.pts[n - 1] - y) < 2)
      return;
    stroke.pts.push(x, y);
    stroke.unsent.push(x, y);
    // Long strokes are sent in pieces the server accepts (at most 200 points each).
    if (stroke.unsent.length >= 400) send(stroke);
    render(stroke, n);
  }

  function up() {
    const stroke = current.current;
    if (!stroke) return;
    clearInterval(stroke.timer);
    if (!stroke.dead) send(stroke);
    current.current = null;
  }

  const others = online == null ? null : Math.max(0, online - 1);

  return (
    <div className="page">
      <header className="top">
        <div className="title">
          <span className="logo" aria-hidden="true" />
          Drawpad
        </div>
        <div className="presence">
          <span className={`dot ${connected ? "on" : ""}`} />
          {others == null
            ? "connecting…"
            : others === 0
              ? "Just you right now"
              : `You and ${others} other${others === 1 ? "" : "s"} drawing`}
        </div>
      </header>

      <main className="main">
        <div className="pad-wrap">
          <canvas
            ref={canvasRef}
            className="pad"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            aria-label="Shared drawing pad"
          />
          {toast && <div className="toast">{toast}</div>}
        </div>

        <div className="toolbar">
          <div className="colors" role="radiogroup" aria-label="Color">
            {colors.map((hex, i) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={color === i}
                aria-label={`Color ${i + 1}`}
                className={`swatch ${color === i ? "picked" : ""}`}
                style={{ background: hex }}
                onClick={() => setColor(i)}
              />
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={color === eraser}
              className={`swatch eraser ${color === eraser ? "picked" : ""}`}
              onClick={() => setColor(eraser)}
              title="Eraser"
              aria-label="Eraser"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path
                  d="M16.2 3.8 21 8.6a1.5 1.5 0 0 1 0 2.1L12.7 19H20v2H8.3l-5.3-5.3a1.5 1.5 0 0 1 0-2.1L14.1 3.8a1.5 1.5 0 0 1 2.1 0ZM5.1 14.7 9.4 19h.5l3-3-4.3-4.3-3.5 3Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
          <div className="sizes" role="radiogroup" aria-label="Brush size">
            {sizes.map((s, i) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={size === i}
                aria-label={`Brush ${["small", "medium", "large"][i]}`}
                className={`size ${size === i ? "picked" : ""}`}
                onClick={() => setSize(i)}
              >
                <span style={{ width: 4 + i * 6, height: 4 + i * 6 }} />
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className="foot">
        <span>
          Everyone on this page draws on the same pad, live. It lives in the
          memory of one server on <a href="https://orbitdeploy.dev">Orbit</a>,
          so it clears when everyone leaves.
        </span>
        <span className="mono">{deployment}</span>
      </footer>
    </div>
  );
}
