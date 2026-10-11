import type { NextRequest } from "next/server";
import { checkLinks } from "@/lib/seo/link-check";
import { jsonError, requireSession } from "@/lib/seo/route-auth";

// Up to MAX_BATCH status checks (12 at a time, ≤2 per host). No new check
// starts after 25s; unstarted items come back null and the browser
// re-queues them — so a slow host can't push this past maxDuration.
export const maxDuration = 60;

const MAX_BATCH = 40;

/**
 * Status-only link checks (phase 3). Unlike /api/seo/fetch this accepts
 * off-site URLs — it's checking outbound links — but it only ever returns
 * a status and verdict, never page content, and every request goes through
 * the same SSRF guard.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  let body: { items?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) return jsonError("Missing items.", 400);
  if (body.items.length > MAX_BATCH) return jsonError(`At most ${MAX_BATCH} items per request.`, 400);

  const items: { url: string; kind: "external" | "asset" }[] = [];
  for (const raw of body.items) {
    const item = raw as { url?: unknown; kind?: unknown };
    if (typeof item?.url !== "string" || (item.kind !== "external" && item.kind !== "asset")) {
      return jsonError("Each item needs a url and a kind of external or asset.", 400);
    }
    try {
      const u = new URL(item.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      return jsonError(`Not an http(s) URL: ${item.url}`, 400);
    }
    items.push({ url: item.url, kind: item.kind });
  }

  const results = await checkLinks(items, { concurrency: 12 });
  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
