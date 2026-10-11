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
  /** Count of external links found. */
  externalLinkCount: number;
  /** External <a href> targets (phase 3 checks these, status only). */
  externalLinks: string[];
  /**
   * Same-site files and images: <a href> to non-page URLs (PDFs, downloads)
   * and <img src>. Not crawled as pages; phase 3 checks they load.
   */
  assetLinks: string[];
  /** URL → its link text (first occurrence; image alt or "Image" for <img>). */
  linkText: Record<string, string>;
  /** On-page SEO data (phase 2). Null for non-HTML or failed responses. */
  onPage: OnPageData | null;
}

/** Everything the phase 2 on-page checks read. Extracted server-side. */
export interface OnPageData {
  /** Number of <title> elements (more than one is itself a problem). */
  titleCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  /** Text of each <h1>, whitespace-collapsed (empty string for an empty H1). */
  h1s: string[];
  /** Canonical href, resolved to an absolute URL. */
  canonical: string | null;
  canonicalCount: number;
  /** Content of <meta name="robots"> (and googlebot), lower-cased. */
  metaRobots: string | null;
  /** X-Robots-Tag response header, lower-cased. */
  xRobotsTag: string | null;
  lang: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  imageCount: number;
  /** <img> elements with no alt attribute at all (alt="" is valid: decorative). */
  imagesMissingAlt: number;
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
  /** Phase 3: status checks on external links and same-site files/images. */
  linkCheck: LinkCheckState;
}

export type LinkVerdict = "ok" | "broken" | "unverified";

/** Result of a status-only check on one link target. */
export interface LinkCheckResult {
  url: string;
  kind: "external" | "asset";
  /** Final HTTP status, or 0 if there was no response. */
  status: number;
  finalUrl: string;
  verdict: LinkVerdict;
  /** Short human reason, e.g. "HTTP 404", "Domain not found", "Blocked (403)". */
  reason: string;
}

export interface LinkCheckState {
  status: "pending" | "running" | "complete" | "cancelled" | "skipped";
  /** Unique targets found across all crawled pages. */
  found: number;
  /** Targets actually checked (≤ MAX_LINK_CHECKS). */
  total: number;
  results: LinkCheckResult[];
}

/** Ceiling on status checks per audit (files/images first, then external links by how many pages use them). */
export const MAX_LINK_CHECKS = 3000;

/** Default page cap for an audit. */
export const PAGE_LIMIT = 500;

/**
 * Caps the person running an audit can choose from. The ceiling is 5,000
 * because v1 keeps results only in the browser tab (a long audit is lost if
 * the tab closes), the report re-renders after every batch (gets sluggish
 * well past a few thousand pages), and sitemap reading stops at 5,000 URLs
 * anyway. Raise it once phase 4 can save an audit as it runs.
 */
export const PAGE_LIMIT_OPTIONS = [500, 1000, 2500, 5000] as const;
export const MAX_PAGE_LIMIT = 5000;

/**
 * Rough crawl speed for time estimates, in pages per second. Measured at
 * ~7/s on contentbloom.com (500 pages in ~70s); rounded down because slower
 * servers are common. Sites with a robots.txt Crawl-delay are far slower.
 */
export const ESTIMATED_PAGES_PER_SECOND = 6;
export const USER_AGENT_TOKEN = "MediasurfaceSEO";
export const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+https://mediasurface.app)`;
