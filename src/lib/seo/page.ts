/**
 * Fetch one URL and turn it into a FetchedPage. Server-only.
 */

import "server-only";
import { safeFetch } from "./fetch-page";
import { extractHtml } from "./extract";
import type { FetchedPage, OnPageData } from "./types";

function isHtmlType(contentType: string | null): boolean {
  if (!contentType) return false;
  const t = contentType.toLowerCase();
  return t.includes("text/html") || t.includes("application/xhtml+xml");
}

/** Statuses worth one quick retry: usually a busy server, not a dead page. */
const TRANSIENT = new Set([500, 502, 503, 504]);

export async function fetchPage(url: string, origin: string): Promise<FetchedPage> {
  let raw = await safeFetch(url, { wantBody: isHtmlType });
  // Found on contentbloom.com, 2026-10-11: six pages returned 500 mid-crawl
  // and loaded fine minutes later. One retry here; the crawler also
  // rechecks anything still failing once the crawl ends.
  if (TRANSIENT.has(raw.status) || raw.errorKind === "reset") {
    await new Promise((r) => setTimeout(r, 1500));
    raw = await safeFetch(url, { wantBody: isHtmlType });
  }
  const isHtml = isHtmlType(raw.contentType);

  let title: string | null = null;
  let internalLinks: string[] = [];
  let externalLinkCount = 0;
  let externalLinks: string[] = [];
  let assetLinks: string[] = [];
  let linkText: Record<string, string> = {};
  let onPage: OnPageData | null = null;

  if (isHtml && raw.body.length > 0) {
    const extracted = extractHtml(
      raw.body.toString("utf8"),
      raw.finalUrl,
      origin,
      raw.headers["x-robots-tag"] ?? null
    );
    title = extracted.title;
    internalLinks = extracted.internalLinks;
    externalLinkCount = extracted.externalLinkCount;
    externalLinks = extracted.externalLinks;
    assetLinks = extracted.assetLinks;
    linkText = extracted.linkText;
    onPage = extracted.onPage;
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
    externalLinks,
    assetLinks,
    linkText,
    onPage,
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
