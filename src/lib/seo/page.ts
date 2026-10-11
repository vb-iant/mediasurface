/**
 * Fetch one URL and turn it into a FetchedPage. Server-only.
 */

import "server-only";
import { safeFetch } from "./fetch-page";
import { extractHtml } from "./extract";
import type { FetchedPage } from "./types";

function isHtmlType(contentType: string | null): boolean {
  if (!contentType) return false;
  const t = contentType.toLowerCase();
  return t.includes("text/html") || t.includes("application/xhtml+xml");
}

export async function fetchPage(url: string, origin: string): Promise<FetchedPage> {
  const raw = await safeFetch(url, { wantBody: isHtmlType });
  const isHtml = isHtmlType(raw.contentType);

  let title: string | null = null;
  let internalLinks: string[] = [];
  let externalLinkCount = 0;

  if (isHtml && raw.body.length > 0) {
    const extracted = extractHtml(raw.body.toString("utf8"), raw.finalUrl, origin);
    title = extracted.title;
    internalLinks = extracted.internalLinks;
    externalLinkCount = extracted.externalLinkCount;
  }

  return {
    url,
    finalUrl: raw.finalUrl,
    status: raw.status,
    redirectChain: raw.redirectChain,
    contentType: raw.contentType,
    isHtml,
    timeMs: raw.timeMs,
    sizeBytes: raw.body.length,
    truncated: raw.truncated,
    error: raw.error,
    title,
    internalLinks,
    externalLinkCount,
  };
}

/** Run async work over items with at most `limit` in flight. */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
