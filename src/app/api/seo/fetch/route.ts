import type { NextRequest } from "next/server";
import { fetchPage, mapWithLimit } from "@/lib/seo/page";
import { jsonError, requireSession } from "@/lib/seo/route-auth";
import { isSameSite } from "@/lib/seo/urls";
import { parseTarget, type TargetPhrase } from "@/lib/seo/content/text";
import { MAX_TARGET_PHRASES } from "@/lib/seo/content/model";

// Up to MAX_BATCH pages, CONCURRENCY at a time, each with a 15s deadline.
export const maxDuration = 60;

const MAX_BATCH = 10;
const CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  let body: { origin?: unknown; urls?: unknown; content?: unknown };
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

  // Content scan (phase 6): { content: { phrases: string[] } } switches on
  // phrase extraction and counts the target phrases against each page's text.
  let contentPhrases: TargetPhrase[] | null = null;
  if (body.content != null) {
    const raw = (body.content as { phrases?: unknown }).phrases;
    const list = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
    if (list.length > MAX_TARGET_PHRASES) return jsonError(`At most ${MAX_TARGET_PHRASES} phrases.`, 400);
    contentPhrases = list.map((p) => parseTarget(p.slice(0, 100))).filter((p): p is TargetPhrase => p !== null);
  }

  const pages = await mapWithLimit(urls, CONCURRENCY, (u) => fetchPage(u, origin, contentPhrases));
  return Response.json({ pages }, { headers: { "cache-control": "no-store" } });
}
