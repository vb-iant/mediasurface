import type { NextRequest } from "next/server";
import { runPageSpeed, SpeedConfigError } from "@/lib/seo/pagespeed";
import { jsonError, requireSession } from "@/lib/seo/route-auth";

// One Lighthouse run per request (10–25s typically; capped at 50s inside).
export const maxDuration = 60;

/**
 * Page speed for one URL (phase 5b). Google runs Lighthouse from its own
 * servers; this route only holds the API key. `diagnose` adds the list of
 * what to fix.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  let body: { url?: unknown; strategy?: unknown; diagnose?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }
  if (typeof body.url !== "string") return jsonError("Missing url.", 400);
  try {
    const u = new URL(body.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
  } catch {
    return jsonError("Not an http(s) URL.", 400);
  }
  const strategy = body.strategy === "desktop" ? "desktop" : "mobile";
  try {
    const result = await runPageSpeed(body.url, strategy, body.diagnose === true);
    return Response.json({ result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof SpeedConfigError) return jsonError(err.message, 503);
    throw err;
  }
}
