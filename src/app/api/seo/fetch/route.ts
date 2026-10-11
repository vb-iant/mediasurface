import type { NextRequest } from "next/server";
import { fetchPage, mapWithLimit } from "@/lib/seo/page";
import { jsonError, requireSession } from "@/lib/seo/route-auth";
import { isSameSite } from "@/lib/seo/urls";

// Up to MAX_BATCH pages, CONCURRENCY at a time, each with a 15s deadline.
export const maxDuration = 60;

const MAX_BATCH = 10;
const CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  let body: { origin?: unknown; urls?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }

  const origin = typeof body.origin === "string" ? body.origin : null;
  if (!origin) return jsonError("Missing origin.", 400);
  try {
    new URL(origin);
  } catch {
    return jsonError("Invalid origin.", 400);
  }

  if (!Array.isArray(body.urls) || body.urls.length === 0) return jsonError("Missing urls.", 400);
  if (body.urls.length > MAX_BATCH) return jsonError(`At most ${MAX_BATCH} urls per request.`, 400);

  const urls = body.urls.filter((u): u is string => typeof u === "string");
  // This route crawls one site's pages. It isn't a general-purpose proxy:
  // anything off the audited site is refused. (External link checks in
  // phase 3 get their own status-only path.)
  if (urls.length !== body.urls.length || urls.some((u) => !isSameSite(u, origin))) {
    return jsonError("All urls must be on the site being audited.", 400);
  }

  const pages = await mapWithLimit(urls, CONCURRENCY, (u) => fetchPage(u, origin));
  return Response.json({ pages }, { headers: { "cache-control": "no-store" } });
}
