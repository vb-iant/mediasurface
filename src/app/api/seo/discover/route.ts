import type { NextRequest } from "next/server";
import { discover, DiscoveryError } from "@/lib/seo/discovery";
import { jsonError, requireSession } from "@/lib/seo/route-auth";
import { normaliseInputUrl } from "@/lib/seo/urls";

// Resolve start URL + robots.txt + up to 50 sitemap files.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }

  const url = typeof body.url === "string" ? normaliseInputUrl(body.url) : null;
  if (!url) return jsonError("Enter a valid website address, e.g. https://example.com", 400);

  try {
    const result = await discover(url);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof DiscoveryError) return jsonError(err.message, 422);
    console.error("[seo/discover]", err);
    return jsonError("Discovery failed unexpectedly.", 500);
  }
}
