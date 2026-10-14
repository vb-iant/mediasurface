import type { NextRequest } from "next/server";
import { jsonError, requireSession } from "@/lib/seo/route-auth";
import { clientLink, MAX_UPLOAD_BYTES, publishReport } from "@/lib/client-reports/admin";
import { StorageNotConfiguredError } from "@/lib/client-reports/storage";

export const maxDuration = 30;

/**
 * Publishes one audit for a client. Body: the gzipped PublishedReport JSON
 * built in the browser (src/lib/seo/report/publish.ts). Checked here
 * (size, unzips, right version) before it's stored.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/client-reports/[token]/publish">) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const { token } = await ctx.params;
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD_BYTES) return jsonError("Report is too large to publish.", 413);
  const gz = Buffer.from(await request.arrayBuffer());
  if (!gz.length) return jsonError("Empty upload.", 400);
  try {
    const report = await publishReport(token, gz);
    return Response.json({ report, link: clientLink(token) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return jsonError(err.message, 503);
    return jsonError(err instanceof Error ? err.message : "Couldn't publish.", 400);
  }
}
