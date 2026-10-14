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
import { isSameSite, isShareLink, looksLikePage, urlKey } from "./urls";
import type { AuditPage, AuditResult, DiscoveryResult, FetchedPage, LinkCheckResult } from "./types";
import { MAX_LINK_CHECKS, MAX_PAGE_LIMIT, PAGE_LIMIT } from "./types";

export type FetchBatch = (origin: string, urls: string[]) => Promise<FetchedPage[]>;

export interface LinkCheckItem {
  url: string;
  kind: LinkCheckResult["kind"];
}
/**
 * Status-checks a batch; null = not started this time (re-queued).
 * `perHost` caps requests in flight to any one host (server clamps 1–4).
 */
export type CheckBatch = (
  items: LinkCheckItem[],
  opts?: { perHost?: number }
) => Promise<(LinkCheckResult | null)[]>;

interface QueueItem {
  url: string;
  depth: number | null;
}

export interface CrawlOptions {
  requestedUrl: string;
  discovery: DiscoveryResult;
  fetchBatch: FetchBatch;
  /** Phase 3 link checks. Omit to skip them (e.g. in tests). */
  checkBatch?: CheckBatch;
  /** "Check external links" box. Same-site files/images are always checked. Default true. */
  checkExternal?: boolean;
  signal: AbortSignal;
  onProgress: (audit: AuditResult, queued: number) => void;
  pageLimit?: number;
}

const DEFAULT_BATCH = 10;
const DEFAULT_DELAY_MS = 300;
const CHECK_BATCH = 40;
const CHECK_DELAY_MS = 200;
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
  const { requestedUrl, discovery, fetchBatch, checkBatch, signal, onProgress } = options;
  const checkExternal = options.checkExternal ?? true;
  const pageLimit = Math.min(Math.max(1, Math.floor(options.pageLimit ?? PAGE_LIMIT)), MAX_PAGE_LIMIT);
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
    linkCheck: {
      status: "pending",
      found: 0,
      total: 0,
      results: [],
      externalSkipped: !checkExternal,
      externalNotChecked: 0,
      shareLinksSkipped: 0,
    },
    stage: "crawling",
  };
  const linkChecker = checkBatch
    ? createLinkChecker(audit, checkBatch, checkExternal, signal, () => onProgress(snapshot(), pendingCount()))
    : null;
  const pendingCount = () => queue.length + sitemapPending.filter((u) => !seen.has(urlKey(u))).length;

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
    return {
      ...audit,
      pages: pages.slice(),
      blockedByRobots: blockedUrls.slice(),
      linkCheck: { ...audit.linkCheck, results: audit.linkCheck.results.slice() },
    };
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
        // Links on a page that redirected to another site belong to that site.
        if (!finalOnSite) {
          page.internalLinks = [];
          page.externalLinks = [];
          page.assetLinks = [];
          page.linkText = {};
        }
        pages.push(page);

        if (!finalOnSite || !result.isHtml || result.status >= 400) return;
        linkChecker?.addFromPage(page);
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

  if (audit.status === "complete") {
    audit.stage = "rechecking";
    await recheckFailures(audit, pages, origin, fetchBatch, signal, (page) => linkChecker?.addFromPage(page), () =>
      onProgress(snapshot(), 0)
    );
    if (signal.aborted) audit.status = "cancelled";
  }

  if (linkChecker) {
    if (audit.status === "complete") {
      // Crawl's done: same-site files/images now, a little faster since the
      // crawl's own requests to the site have stopped, then wait for the
      // external-link queue to drain.
      audit.stage = "checking-links";
      onProgress(snapshot(), 0);
      await linkChecker.finish();
    } else {
      await linkChecker.stop();
      if (audit.linkCheck.results.length === 0) audit.linkCheck.status = "skipped";
    }
  } else {
    audit.linkCheck.status = "skipped";
  }

  audit.stage = "done";
  audit.finishedAt = new Date().toISOString();
  return snapshot();
}

/**
 * Give pages that failed with a server error, reset or timeout one more try
 * after a pause, once the crawl's load on the site has stopped. A page is
 * only reported broken if it fails here too (it has already had a quick
 * server-side retry). If a recheck succeeds, its links count for link
 * checks and sitemap comparisons, but aren't crawled further — the crawl
 * is over by then.
 */
async function recheckFailures(
  audit: AuditResult,
  pages: AuditPage[],
  origin: string,
  fetchBatch: FetchBatch,
  signal: AbortSignal,
  onRecovered: (page: AuditPage) => void,
  progress: () => void
): Promise<void> {
  const retryable = (p: AuditPage) =>
    p.status >= 500 || (p.status === 0 && /timed out|reset/i.test(p.error ?? ""));
  const failed = pages.map((p, i) => ({ p, i })).filter(({ p }) => retryable(p));
  if (failed.length === 0) return;

  await sleep(3000, signal);
  for (let start = 0; start < failed.length && !signal.aborted; start += DEFAULT_BATCH) {
    const chunk = failed.slice(start, start + DEFAULT_BATCH);
    let results: FetchedPage[];
    try {
      results = await fetchBatch(origin, chunk.map(({ p }) => p.url));
    } catch {
      return; // keep the original results; nothing worse than before
    }
    results.forEach((r, k) => {
      const { p, i } = chunk[k];
      if (retryable({ ...p, ...r } as AuditPage)) return;
      pages[i] = { ...r, depth: p.depth, inSitemap: p.inSitemap, inlinkCount: p.inlinkCount };
      if (r.isHtml && isSameSite(r.finalUrl, origin)) onRecovered(pages[i]);
    });
    progress();
    await sleep(DEFAULT_DELAY_MS, signal);
  }
}

/**
 * Phase 3 link checks, streamed alongside the crawl (phase 4 change).
 *
 * - External links are checked as pages arrive: one check request runs
 *   alongside the page fetches, so by the end of the crawl most are done.
 *   Before this, every check waited for the crawl to finish — ~3 of ~5
 *   minutes on contentbloom.com.
 * - The audited site's own files/images are held until the crawl ends, so
 *   the site isn't hit by page fetches and file checks at the same time;
 *   then they're checked with up to 4 in flight (the crawl used 5).
 * - Targets are checked in the order found, up to MAX_LINK_CHECKS.
 */
function createLinkChecker(
  audit: AuditResult,
  checkBatch: CheckBatch,
  checkExternal: boolean,
  signal: AbortSignal,
  progress: () => void
) {
  const state = audit.linkCheck;
  const seenTargets = new Set<string>();
  const skippedExternal = new Set<string>();
  const shareLinks = new Set<string>();
  const externals: LinkCheckItem[] = [];
  const assets: LinkCheckItem[] = [];
  let assetsReleased = false;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  let stalls = 0;

  const queueTarget = (url: string, kind: LinkCheckItem["kind"]) => {
    if (seenTargets.has(url)) return;
    seenTargets.add(url);
    state.found++;
    if (state.total >= MAX_LINK_CHECKS) return;
    state.total++;
    (kind === "asset" ? assets : externals).push({ url, kind });
  };

  function nextBatch(): { items: LinkCheckItem[]; perHost: number } | null {
    if (assetsReleased && assets.length) return { items: assets.splice(0, CHECK_BATCH), perHost: 4 };
    if (externals.length) return { items: externals.splice(0, CHECK_BATCH), perHost: 2 };
    return null;
  }

  function pump(): void {
    if (inFlight || stopped || signal.aborted) return;
    const next = nextBatch();
    if (!next) return;
    if (state.status === "pending") state.status = "running";
    inFlight = (async () => {
      let results: (LinkCheckResult | null)[];
      try {
        results = await checkBatch(next.items, { perHost: next.perHost });
      } catch {
        if (signal.aborted) return;
        await sleep(1500, signal);
        try {
          results = await checkBatch(next.items, { perHost: next.perHost });
        } catch (err) {
          stopped = true;
          state.status = "cancelled";
          audit.error = `Link checking stopped early: ${err instanceof Error ? err.message : String(err)}`;
          return;
        }
      }
      const notStarted = next.items.filter((_, i) => !results[i]);
      for (const r of results) if (r) state.results.push(r);
      // Anything the server's time budget didn't reach goes back on the front.
      const target = next.items[0]?.kind === "asset" ? assets : externals;
      target.unshift(...notStarted);
      stalls = notStarted.length === next.items.length ? stalls + 1 : 0;
      if (stalls >= 3) {
        stopped = true;
        state.status = "cancelled";
        audit.error = "Link checking stopped early: the checker kept running out of time.";
        return;
      }
      progress();
      await sleep(CHECK_DELAY_MS, signal);
    })().finally(() => {
      inFlight = null;
      pump();
    });
  }

  return {
    addFromPage(page: AuditPage) {
      for (const url of page.assetLinks ?? []) queueTarget(url, "asset");
      for (const url of page.externalLinks ?? []) {
        if (isShareLink(url)) {
          shareLinks.add(url);
          continue;
        }
        if (checkExternal) queueTarget(url, "external");
        else skippedExternal.add(url);
      }
      state.externalNotChecked = skippedExternal.size;
      state.shareLinksSkipped = shareLinks.size;
      pump();
    },
    /** Crawl finished: release same-site files, then wait until every queue is empty. */
    async finish() {
      assetsReleased = true;
      if (state.total === 0) {
        state.status = "complete";
        return;
      }
      pump();
      while (!stopped && !signal.aborted && (inFlight || assets.length || externals.length)) {
        if (inFlight) await inFlight;
        else pump();
        if (!inFlight && (assets.length || externals.length) && !stopped) await sleep(50, signal);
      }
      if (!stopped) state.status = signal.aborted ? "cancelled" : "complete";
    },
    /** Crawl was cancelled or failed: let the request in flight finish, then stop. */
    async stop() {
      stopped = true;
      if (inFlight) await inFlight;
      if (state.status === "running" || state.status === "pending") {
        state.status = state.results.length ? "cancelled" : "skipped";
      }
    },
  };
}
