import type { NextRequest } from "next/server";
import { jsonError, requireSession } from "@/lib/seo/route-auth";
import { deleteReport } from "@/lib/client-reports/admin";
import { storageError } from "@/lib/client-reports/http";

/** DELETE ?path=reports/<token>/<file> — unpublish one report. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/client-reports/[token]/reports">) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const { token } = await ctx.params;
  const pathname = request.nextUrl.searchParams.get("path") ?? "";
  try {
    const ok = await deleteReport(token, pathname);
    return ok ? new Response(null, { status: 204 }) : jsonError("Unknown report.", 404);
  } catch (err) {
    return storageError(err);
  }
}
