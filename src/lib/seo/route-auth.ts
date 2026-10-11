/**
 * Auth check for the SEO API routes.
 *
 * src/proxy.ts only gates /admin/* (and answers with a redirect to the
 * login page, which is wrong for a fetch() call). The SEO routes live under
 * /api/seo/* and check the same signed session cookie themselves, returning
 * a plain 401 — so they're gated no matter what the proxy matcher says.
 */

import "server-only";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

export async function requireSession(request: NextRequest): Promise<Response | null> {
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (ok) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}
