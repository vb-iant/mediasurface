/**
 * SEO audit data contract.
 *
 * `AuditResult` is the single object the on-screen report renders from. The
 * later PDF download renders from the same object, and phase 4 (saved
 * history) would persist exactly this JSON — so keep it plain,
 * serialisable data: no class instances, no Maps/Sets, no functions.
 *
 * Pure types only — imported by both the server routes and the client page.
 */

export interface RedirectHop {
  url: string;
  status: number;
}

/** What the server returns for one fetched URL. */
export interface FetchedPage {
  /** The URL as requested. */
  url: string;
  /** Where the request ended up after following redirects. */
  finalUrl: string;
  /** Final HTTP status, or 0 if the request never got a response. */
  status: number;
  /** Every hop before the final response (empty if no redirects). */
  redirectChain: RedirectHop[];
  contentType: string | null;
  isHtml: boolean;
  /** Total time across all hops, in ms. */
  timeMs: number;
  /** Bytes of the final response body actually read (capped). */
  sizeBytes: number;
  /** True if the body exceeded the size cap and was cut off. */
  truncated: boolean;
  /** Network/guard error, if the fetch failed outright. */
  error: string | null;
  title: string | null;
  /** Internal links found on the page (absolute, fragment-stripped). */
  internalLinks: string[];
  /** Count of external links found (checked in phase 3). */
  externalLinkCount: number;
}

/** A page as recorded in the audit — fetch result plus crawl context. */
export interface AuditPage extends FetchedPage {
  /** Link depth from the start URL; null if only reached via the sitemap. */
  depth: number | null;
  inSitemap: boolean;
  /** Number of crawled pages that link here. */
  inlinkCount: number;
}

export interface RobotsGroupRule {
  allow: boolean;
  path: string;
}

export interface RobotsInfo {
  url: string;
  found: boolean;
  status: number;
  /** Sitemap: directives found in robots.txt. */
  sitemaps: string[];
  /** Rules from the group that applies to our crawler (ours, else `*`). */
  rules: RobotsGroupRule[];
  /** Crawl-delay for our group, in seconds, if set. */
  crawlDelay: number | null;
  error: string | null;
}

export interface SitemapInfo {
  found: boolean;
  /** Sitemap files actually read (including nested ones from an index). */
  sources: string[];
  /** Page URLs listed across all sitemaps, same-site only, de-duplicated. */
  urls: string[];
  /** True if we stopped reading early because of file/URL limits. */
  truncated: boolean;
  /** Sitemap URLs listed for a different host (excluded from `urls`). */
  offSiteCount: number;
  errors: string[];
}

export interface DiscoveryResult {
  /** The start URL after following any redirects (e.g. http → https). */
  startUrl: string;
  /** Origin the audit is scoped to, e.g. https://www.example.com */
  origin: string;
  robots: RobotsInfo;
  sitemap: SitemapInfo;
}

export interface AuditResult {
  /** Bumped if the shape changes in a way stored copies would care about. */
  version: 1;
  requestedUrl: string;
  discovery: DiscoveryResult;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "complete" | "cancelled" | "error";
  error: string | null;
  pageLimit: number;
  /** True if the crawl stopped because it hit `pageLimit`. */
  capReached: boolean;
  pages: AuditPage[];
  /** Internal URLs we found but didn't fetch because robots.txt disallows them. */
  blockedByRobots: string[];
}

export const PAGE_LIMIT = 500;
export const USER_AGENT_TOKEN = "MediasurfaceSEO";
export const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+https://mediasurface.app)`;
