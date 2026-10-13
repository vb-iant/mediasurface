/// <reference lib="webworker" />
/**
 * Builds the content scan model off the main thread: at 5,000 pages it
 * takes a few seconds, which would freeze the admin if run in a render.
 */

import { buildContentModel } from "@/lib/seo/content/model";
import type { AuditResult } from "@/lib/seo/types";

self.onmessage = (e: MessageEvent<{ seq: number; audit: AuditResult; phrases: string[] }>) => {
  const { seq, audit, phrases } = e.data;
  try {
    self.postMessage({ seq, model: buildContentModel(audit, phrases), error: null });
  } catch (err) {
    self.postMessage({ seq, model: null, error: err instanceof Error ? err.message : String(err) });
  }
};
