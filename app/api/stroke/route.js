import { draw } from "../../lib/board";

export const dynamic = "force-dynamic";

/** The visitor's IP. Caddy, in front of Orbit, overwrites X-Forwarded-For, so it can't be spoofed. */
function visitor(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}

export async function POST(request) {
  const chunk = await request.json().catch(() => null);
  const result = draw(visitor(request), chunk);
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
