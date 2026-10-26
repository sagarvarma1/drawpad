import { allStrokes, join, online } from "../../lib/board";

export const dynamic = "force-dynamic";

// Server-sent events: the whole drawing once, then new points as people draw them.
export function GET(request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const leave = join(write);
      if (!leave) {
        write(`data: ${JSON.stringify({ type: "full" })}\n\n`);
        controller.close();
        return;
      }
      write(
        `retry: 2000\ndata: ${JSON.stringify({ type: "hello", strokes: allStrokes(), online: online() })}\n\n`,
      );
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        leave();
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
