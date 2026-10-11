/**
 * Browser-orchestrated crawl.
 *
 * Runs in the /admin/seo page. Holds the queue, visited set and results in
 * memory and asks the server to fetch pages in small batches via
 * POST /api/seo/fetch. That keeps each serverless call short and means no
 * storage is needed — the trade-off is the audit lives only in this browser
 * tab until it's exported (PDF, later) or saved (phase 4, later).
 *
 * Order: breadth-first from the start URL, so link depth is accurate. Once
 * links run out, URLs that only appear in the sitemap are fetched too
 * (depth = null), until the page limit.
 */

import { isAllowedByRobots } from "./robots";
import { isSameSite, looksLikePage, urlKey } from "./urls";
import type { AuditPage, AuditResult, DiscoveryResult, FetchedPage } from "./types";
import { PAGE_LIMIT } from "./types";

export type FetchBatch = (origin: string, urls: string[]) => Promise<FetchedPage[]>;

interface QueueItem {
  url: string;
  depth: number | null;
}

export interface CrawlOptions {
  requestedUrl: string;
  discovery: DiscoveryResult;
  fetchBatch: FetchBatch;
  signal: AbortSignal;
  onProgress: (audit: AuditResult, queued: number) => void;
  pageLimit?: number;
}

const DEFAULT_BATCH = 10;
const DEFAULT_DELAY_MS = 300;
/** Honour a site's Crawl-delay, but never wait more than this between requests. */
const MAX_CRAWL_DELAY_S = 10;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

export function crawlPacing(discovery: DiscoveryResult): { batchSize: number; delayMs: number } {
  const delay = discovery.robots.crawlDelay;
  if (delay && delay > 0) {
    return { batchSize: 1, delayMs: Math.min(delay, MAX_CRAWL_DELAY_S) * 1000 };
  }
  return { batchSize: DEFAULT_BATCH, delayMs: DEFAULT_DELAY_MS };
}

export async function runCrawl(options: CrawlOptions): Promise<AuditResult> {
  const { requestedUrl, discovery, fetchBatch, signal, onProgress } = options;
  const pageLimit = options.pageLimit ?? PAGE_LIMIT;
  const { origin, robots } = discovery;
  const { batchSize, delayMs } = crawlPacing(discovery);

  const sitemapKeys = new Set(discovery.sitemap.urls.map(urlKey));
  const seen = new Set<string>(); // every URL key ever queued, fetched or blocked
  const blockedUrls: string[] = [];
  const queue: QueueItem[] = [];
  const pages: AuditPage[] = [];
  /** target key → set of source page keys linking to it */
  const inlinks = new Map<string, Set<string>>();

  const audit: AuditResult = {
    version: 1,
    requestedUrl,
    discovery,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    error: null,
    pageLimit,
    capReached: false,
    pages,
    blockedByRobots: blockedUrls,
  };

  function enqueue(url: string, depth: number | null): void {
    const key = urlKey(url);
    if (seen.has(key)) return;
    if (!isSameSite(url, origin) || !looksLikePage(url)) return;
    seen.add(key);
    if (!isAllowedByRobots(url, robots.rules)) {
      blockedUrls.push(url);
      return;
    }
    queue.push({ url, depth });
  }

  const sitemapPending = discovery.sitemap.urls.slice();
  function nextBatch(): QueueItem[] {
    const room = Math.min(batchSize, pageLimit - pages.length);
    const batch: QueueItem[] = [];
    while (batch.length < room && queue.length > 0) batch.push(queue.shift()!);
    if (batch.length > 0) return batch;
    // Links exhausted — move on to sitemap-only URLs. Never mix these into a
    // batch with link-discovered pages: pages in flight may link to them, and
    // a page reached by a link should be recorded with its real depth, not
    // as sitemap-only.
    while (batch.length < room && sitemapPending.length > 0) {
      const url = sitemapPending.shift()!;
      const before = queue.length;
      enqueue(url, null);
      if (queue.length > before) batch.push(queue.pop()!);
    }
    return batch;
  }

  function snapshot(): AuditResult {
    for (const page of pages) {
      page.inlinkCount = inlinks.get(urlKey(page.finalUrl))?.size ?? inlinks.get(urlKey(page.url))?.size ?? 0;
    }
    return { ...audit, pages: pages.slice(), blockedByRobots: blockedUrls.slice() };
  }

  enqueue(discovery.startUrl, 0);
  if (queue.length === 0) {
    audit.status = "error";
    audit.error = "robots.txt disallows crawling the start URL, so the audit was stopped.";
    audit.finishedAt = new Date().toISOString();
    return snapshot();
  }

  try {
    while (!signal.aborted && pages.length < pageLimit) {
      const batch = nextBatch();
      if (batch.length === 0) break;

      let results: FetchedPage[];
      try {
        results = await fetchBatch(origin, batch.map((b) => b.url));
      } catch (err) {
        if (signal.aborted) break;
        // One retry for a transient failure of the batch request itself.
        await sleep(1500, signal);
        if (signal.aborted) break;
        results = await fetchBatch(origin, batch.map((b) => b.url)).catch((e2) => {
          throw e2 instanceof Error ? e2 : err;
        });
      }

      results.forEach((result, i) => {
        const { depth } = batch[i];
        const key = urlKey(result.url);
        const finalKey = urlKey(result.finalUrl);
        const finalOnSite = isSameSite(result.finalUrl, origin);

        // A redirect to a page we haven't seen yet counts as visiting it.
        if (finalOnSite && finalKey !== key) seen.add(finalKey);

        const page: AuditPage = {
          ...result,
          depth,
          inSitemap: sitemapKeys.has(key) || (finalOnSite && sitemapKeys.has(finalKey)),
          inlinkCount: 0,
        };
        // Links are only meaningful for crawl purposes on pages that are part of this site.
        if (!finalOnSite) page.internalLinks = [];
        pages.push(page);

        if (!finalOnSite || !result.isHtml || result.status >= 400) return;
        for (const link of result.internalLinks) {
          const target = urlKey(link);
          if (target === finalKey) continue; // self-links don't count as inlinks
          let set = inlinks.get(target);
          if (!set) inlinks.set(target, (set = new Set()));
          set.add(finalKey);
          enqueue(link, depth === null ? null : depth + 1);
        }
      });

      onProgress(snapshot(), queue.length + sitemapPending.filter((u) => !seen.has(urlKey(u))).length);
      if (pages.length < pageLimit && (queue.length > 0 || sitemapPending.length > 0)) {
        await sleep(delayMs, signal);
      }
    }

    const remaining = queue.length + sitemapPending.filter((u) => !seen.has(urlKey(u))).length;
    audit.capReached = pages.length >= pageLimit && remaining > 0;
    audit.status = signal.aborted ? "cancelled" : "complete";
  } catch (err) {
    audit.status = "error";
    audit.error = err instanceof Error ? err.message : String(err);
  }

  audit.finishedAt = new Date().toISOString();
  return snapshot();
}
