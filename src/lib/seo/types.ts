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
  /** Content-Encoding of the final response (gzip, br…), null if uncompressed. */
  contentEncoding: string | null;
  /** On-page SEO data (phase 2). Null for non-HTML or failed responses. */
  onPage: OnPageData | null;
  /**
   * Content scan only (phase 6): phrase data from the page's main text.
   * Absent on technical audits and on non-HTML / failed responses.
   */
  content?: PageContent | null;
}

/**
 * What the content scan keeps per page (phase 6). Extracted server-side from
 * the main text (nav/header/footer/aside/forms excluded, as for word count)
 * so the scan stays small: ~1–2 KB a page rather than the full text.
 */
export interface PageContent {
  /** H2 and H3 text in the main content, in order (capped). */
  headings: string[];
  /** The opening ~60 words of the main content's paragraphs. */
  intro: string;
  /** Most frequent 1–3 word phrases in the main text: [as written, count]. */
  terms: [string, number][];
  /** Words of main text the phrases were counted over. */
  words: number;
  /** Target phrase (TargetPhrase.key) → times it appears in the full main text. */
  phraseHits: Record<string, number>;
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
  /** Phase 4: structured data found on the page. */
  structuredData: StructuredDataInfo;
  /** Phase 4: <meta name="viewport"> present. */
  hasViewport: boolean;
  /** Phase 4: http:// subresources on an https page (first few) and total count. */
  mixedContent: string[];
  mixedContentCount: number;
  /** Phase 4: words of visible body text (nav/header/footer/scripts excluded). */
  wordCount: number;
  /** Phase 4: <link rel="alternate" hreflang> entries. */
  hreflang: { lang: string; href: string }[];
}

export interface StructuredDataInfo {
  /** One entry per JSON-LD item (arrays and @graph flattened). */
  items: StructuredDataItem[];
  /** JSON-LD blocks that didn't parse (first part of the error each). */
  parseErrors: string[];
  /** schema.org types used via microdata (itemtype) — presence only. */
  microdataTypes: string[];
  /** Elements using RDFa typeof — presence only. */
  rdfaCount: number;
}

export interface StructuredDataItem {
  /** @type values, e.g. ["BlogPosting"]. */
  types: string[];
  /** Top-level properties with a non-empty value (not @context/@type). */
  keys: string[];
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
  /** Phase 4: what robots.txt says to each AI crawler, plus llms.txt. */
  ai: AiAccessInfo;
  /** Phase 4: how http/https and www/non-www variants of the homepage behave. */
  hosts: HostVariant[];
}

export interface AiBotAccess {
  token: string;
  /** Allowed to crawl the site root. */
  allowedRoot: boolean;
  /** Allowed to crawl the start page (often the same as root). */
  allowedStart: boolean;
  /** robots.txt names this bot specifically (rather than falling back to `*`). */
  explicit: boolean;
}

export interface AiAccessInfo {
  bots: AiBotAccess[];
  llmsTxt: { url: string; status: "found" | "missing" | "html" | "error"; detail: string | null };
}

export interface HostVariant {
  /** e.g. http://example.com/ */
  url: string;
  /** Where it ended up. */
  finalUrl: string;
  status: number;
  hops: number;
  error: string | null;
  /** True if it lands on the origin the audit is scoped to. */
  reachesCanonical: boolean;
  /** HSTS header on the final response, if any. */
  hsts: string | null;
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
  /** What the audit is doing right now (drives the progress label). */
  stage: "crawling" | "rechecking" | "checking-links" | "testing-speed" | "done";
  /** Phase 5b: page speed on a sample of pages. Absent on older audits. */
  speed?: SpeedState;
}

// ------------------------------------------------------------ phase 5b: page speed

export type SpeedStrategy = "mobile" | "desktop";

/** One Lighthouse run (PageSpeed Insights), trimmed to what the report uses. */
export interface SpeedResult {
  url: string;
  strategy: SpeedStrategy;
  /** 0–100, or null if Lighthouse couldn't score the page. */
  score: number | null;
  /** Lab metrics in ms (CLS unitless). */
  lcp: number | null;
  cls: number | null;
  tbt: number | null;
  fcp: number | null;
  speedIndex: number | null;
  /** Real-user data for this URL, when Google has enough of it. */
  field: FieldMetrics | null;
  /** Only filled for a diagnosis run. */
  opportunities?: SpeedOpportunity[];
  error: string | null;
  fetchedAt: string;
}

export interface SpeedOpportunity {
  id: string;
  title: string;
  description: string;
  learnMore: string | null;
  displayValue: string | null;
  /** Lighthouse's estimated saving, per metric, in ms (CLS unitless). */
  savings: { lcp?: number; fcp?: number; tbt?: number; cls?: number };
  /** Worst offenders, e.g. the heaviest scripts or images. */
  items: { url: string; detail: string | null }[];
}

/** Chrome UX Report p75 values (28-day real-user data). */
export interface FieldMetrics {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  /** Share of visits rated good, per metric (0–1). */
  goodShare: { lcp?: number; inp?: number; cls?: number };
  collectionPeriod: string | null;
}

export interface SpeedSampleEntry {
  url: string;
  /** Page type it stands for, e.g. "/blog/*". */
  template: string;
  /** How many indexable pages share that page type. */
  templatePages: number;
  /** Set when the page was added because the crawl flagged it as likely slow. */
  reason?: string;
}

export interface SpeedDiagnosis {
  status: "running" | "done" | "error";
  mobile: SpeedResult | null;
  desktop: SpeedResult | null;
  error: string | null;
}

export interface SpeedState {
  status: "pending" | "running" | "complete" | "cancelled" | "skipped" | "error";
  /** How many indexable pages the sample was drawn from. */
  indexablePages: number;
  sample: SpeedSampleEntry[];
  results: SpeedResult[];
  /** Site-wide real-user data (CrUX, origin level, phones). null = not looked up. */
  field: { found: boolean; phone: FieldMetrics | null; desktop: FieldMetrics | null; error: string | null } | null;
  diagnoses: Record<string, SpeedDiagnosis>;
  error: string | null;
}

/** Sample 10% of indexable pages, at least 5 and at most 50 (Ian, 2026-10-11). */
export const SPEED_SAMPLE_SHARE = 0.1;
export const SPEED_SAMPLE_MIN = 5;
export const SPEED_SAMPLE_MAX = 50;

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
  /** Phase 4: from response headers when the server sends them (files/images). */
  contentLength?: number | null;
  contentType?: string | null;
  cacheControl?: string | null;
}

export interface LinkCheckState {
  status: "pending" | "running" | "complete" | "cancelled" | "skipped";
  /** Unique targets found that are eligible for checking. */
  found: number;
  /** Targets queued for checking so far (≤ MAX_LINK_CHECKS). */
  total: number;
  results: LinkCheckResult[];
  /** True when the "Check external links" box was unticked. */
  externalSkipped: boolean;
  /** Unique external links found but not checked because of that. */
  externalNotChecked: number;
  /** Social share links found (one per page per network) — never checked. Absent on older audits. */
  shareLinksSkipped?: number;
}

/** Ceiling on status checks per audit (in the order targets are found). */
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
