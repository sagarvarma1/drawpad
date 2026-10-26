import { timingSafeEqual } from "node:crypto";
import { clear } from "../../../lib/board";

export const dynamic = "force-dynamic";

// Moderation: wipe the drawing. Only exists when ADMIN_TOKEN is set (an Orbit env var).
export function POST(request) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return new Response("Not found", { status: 404 });
  const given = Buffer.from(
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
  );
  const expected = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  clear();
  return Response.json({ ok: true });
}
