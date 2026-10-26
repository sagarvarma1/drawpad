// The drawing: every stroke anyone has drawn, held in the memory of this deployment's server.
// Everyone viewing the deployment talks to the same process, so they all share it.
// It lives on globalThis because Next bundles pages and route handlers separately.

/** Strokes use a fixed 1000x1000 coordinate space; each client scales it to its screen. */
export const WIDTH = 1000;
export const HEIGHT = 1000;
export const COLORS = [
  "#f4f4f8",
  "#ff5d73",
  "#ff9f43",
  "#ffd166",
  "#06d6a0",
  "#4cc9f0",
  "#7c5cff",
  "#ff70a6",
];
export const BACKGROUND = "#101015";
/** Index COLORS.length is the eraser: it paints with the background color. */
export const ERASER = COLORS.length;
export const SIZES = [4, 10, 24];

/** Oldest strokes fade out past this many points, so memory and the initial load stay small. */
const MAX_POINTS = 60_000;
/** Points per visitor: a bucket that refills, plus a cap across everyone. */
const BUCKET = 1500;
const REFILL_PER_SECOND = 400;
const MAX_POINTS_PER_SECOND = 20_000;
const MAX_VIEWERS = 1000;

const board = (globalThis.__drawpad ??= {
  strokes: new Map(),
  points: 0,
  viewers: new Set(),
  pending: [],
  flushTimer: null,
  buckets: new Map(),
  second: { at: 0, count: 0 },
});

export function online() {
  return board.viewers.size;
}

/** Every stroke, in order, as sent to someone who just arrived. */
export function allStrokes() {
  return [...board.strokes.entries()].map(([id, s]) => ({
    id,
    c: s.c,
    s: s.s,
    pts: s.pts,
  }));
}

function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const write of board.viewers) write(frame);
}

/** New points go out in small batches (every 20ms) rather than one message per mouse move. */
function scheduleFlush() {
  if (board.flushTimer) return;
  board.flushTimer = setTimeout(() => {
    board.flushTimer = null;
    const chunks = board.pending;
    board.pending = [];
    if (chunks.length) broadcast({ type: "draw", chunks, online: online() });
  }, 20);
}

function allow(who, cost, now) {
  const second = Math.floor(now / 1000);
  if (board.second.at !== second) board.second = { at: second, count: 0 };
  if (board.second.count + cost > MAX_POINTS_PER_SECOND) return false;
  const bucket = board.buckets.get(who) ?? { tokens: BUCKET, at: now };
  bucket.tokens = Math.min(
    BUCKET,
    bucket.tokens + ((now - bucket.at) / 1000) * REFILL_PER_SECOND,
  );
  bucket.at = now;
  board.buckets.set(who, bucket);
  if (bucket.tokens < cost) return false;
  bucket.tokens -= cost;
  board.second.count += cost;
  if (board.buckets.size > 5000) {
    for (const [key, b] of board.buckets)
      if (now - b.at > 10_000) board.buckets.delete(key);
  }
  return true;
}

function valid(chunk) {
  const { id, c, s, pts } = chunk ?? {};
  if (typeof id !== "string" || !/^[a-z0-9]{6,24}$/.test(id)) return false;
  if (
    !Number.isInteger(c) ||
    c < 0 ||
    c > ERASER ||
    !Number.isInteger(s) ||
    s < 0 ||
    s >= SIZES.length
  )
    return false;
  if (
    !Array.isArray(pts) ||
    pts.length < 2 ||
    pts.length > 400 ||
    pts.length % 2
  )
    return false;
  return pts.every(
    (v, i) => Number.isInteger(v) && v >= 0 && v <= (i % 2 ? HEIGHT : WIDTH),
  );
}

/** Adds points to a stroke (starting it if new) for one visitor. */
export function draw(who, chunk) {
  if (!valid(chunk)) return { ok: false, status: 400, error: "Invalid stroke" };
  const cost = chunk.pts.length / 2;
  if (!allow(who, cost, Date.now()))
    return { ok: false, status: 429, error: "Slow down a little" };
  let stroke = board.strokes.get(chunk.id);
  if (!stroke) {
    stroke = { c: chunk.c, s: chunk.s, pts: [] };
    board.strokes.set(chunk.id, stroke);
  }
  stroke.pts.push(...chunk.pts);
  board.points += cost;
  board.pending.push({
    id: chunk.id,
    c: stroke.c,
    s: stroke.s,
    pts: chunk.pts,
  });
  // Drop the oldest strokes once the board is full.
  for (const [id, old] of board.strokes) {
    if (board.points <= MAX_POINTS || id === chunk.id) break;
    board.points -= old.pts.length / 2;
    board.strokes.delete(id);
    board.pending.push({ id, removed: true });
  }
  scheduleFlush();
  return { ok: true };
}

export function clear() {
  board.strokes.clear();
  board.points = 0;
  board.pending = [];
  broadcast({ type: "clear", online: online() });
}

/** Adds a viewer's stream writer; returns the unsubscribe function, or null when full. */
export function join(write) {
  if (board.viewers.size >= MAX_VIEWERS) return null;
  board.viewers.add(write);
  broadcast({ type: "presence", online: online() });
  return () => {
    if (board.viewers.delete(write))
      broadcast({ type: "presence", online: online() });
  };
}
