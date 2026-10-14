import type { NextRequest } from "next/server";
import { jsonError, requireSession } from "@/lib/seo/route-auth";
import { resetPasscode, setRevoked } from "@/lib/client-reports/admin";
import { storageError } from "@/lib/client-reports/http";

/**
 * PATCH { action: "reset" }   → new passcode (returned once; the old one stops working)
 * PATCH { action: "revoke" }  → the client's link stops working; reports are kept
 * PATCH { action: "restore" } → undo revoke
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/client-reports/[token]">) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const { token } = await ctx.params;
  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }
  try {
    if (body.action === "reset") {
      const out = await resetPasscode(token);
      return out ? Response.json(out, { headers: { "cache-control": "no-store" } }) : jsonError("Unknown client.", 404);
    }
    if (body.action === "revoke" || body.action === "restore") {
      const client = await setRevoked(token, body.action === "revoke");
      return client ? Response.json({ client }, { headers: { "cache-control": "no-store" } }) : jsonError("Unknown client.", 404);
    }
    return jsonError("Unknown action.", 400);
  } catch (err) {
    return storageError(err);
  }
}
