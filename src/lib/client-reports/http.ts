import "server-only";
import { jsonError } from "@/lib/seo/route-auth";
import { StorageNotConfiguredError } from "./storage";

export function storageError(err: unknown): Response {
  if (err instanceof StorageNotConfiguredError) return jsonError(err.message, 503);
  console.error("client-reports storage error:", err);
  return jsonError(err instanceof Error ? err.message : "Storage error.", 500);
}
