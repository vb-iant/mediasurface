import type { NextRequest } from "next/server";
import { jsonError, requireSession } from "@/lib/seo/route-auth";
import { createClient, listClients } from "@/lib/client-reports/admin";
import { storageError } from "@/lib/client-reports/http";

/**
 * Clients who can see published SEO reports at tools.velocity-b.com.
 * GET lists them (with their published reports); POST creates one and
 * returns its passcode — the only time the passcode is ever shown, since
 * only a hash is stored. Admin session required.
 */

const noStore = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json({ clients: await listClients() }, { headers: noStore });
  } catch (err) {
    return storageError(err);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }
  if (typeof body.name !== "string" || !body.name.trim()) return jsonError("Client name is required.", 400);
  try {
    const created = await createClient(body.name);
    return Response.json(created, { status: 201, headers: noStore });
  } catch (err) {
    return storageError(err);
  }
}
