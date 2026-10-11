import type { NextRequest } from "next/server";
import { fieldData, SpeedConfigError } from "@/lib/seo/pagespeed";
import { jsonError, requireSession } from "@/lib/seo/route-auth";

export const maxDuration = 30;

/** Site-wide real-user speed data from the Chrome UX Report (phase 5b). */
export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  let body: { origin?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }
  let origin: string;
  try {
    const u = new URL(String(body.origin));
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    origin = u.origin;
  } catch {
    return jsonError("Not an http(s) origin.", 400);
  }
  try {
    return Response.json(await fieldData(origin), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof SpeedConfigError) return jsonError(err.message, 503);
    throw err;
  }
}
