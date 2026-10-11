/**
 * Phase 2: on-page SEO checks. Pure functions over an AuditResult — one per
 * check, each returning a Finding or null. Runs in the browser after every
 * batch, so keep each check a single pass over the pages.
 *
 * Decisions (Ian, 2026-10-11):
 * - Title/description length is judged in characters, not pixels. Google
 *   actually truncates by pixel width, so long ones are worded "may be
 *   truncated" and are warnings, never errors.
 * - noindex pages are notices, not problems — usually intentional. The one
 *   exception is a noindex page that's also in the sitemap, which is a
 *   genuine contradiction and a warning.
 */

import { isSameSite, urlKey } from "../urls";
import type { AuditPage, AuditResult, OnPageData } from "../types";
import type { Finding } from "./types";

export const TITLE_MAX_CHARS = 60;
export const DESCRIPTION_MAX_CHARS = 160;
export const SLOW_RESPONSE_MS = 2000;
export const LARGE_HTML_BYTES = 500 * 1024;

type CheckablePage = AuditPage & { onPage: OnPageData };

interface Context {
  audit: AuditResult;
  /** One entry per distinct final URL: on-site, HTML, 200, with on-page data. */
  pages: CheckablePage[];
  /** urlKey(final URL) → page, across every crawled page (for canonical targets). */
  byKey: Map<string, AuditPage>;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export function isNoindex(op: OnPageData): boolean {
  return /\b(noindex|none)\b/.test(`${op.metaRobots ?? ""} ${op.xRobotsTag ?? ""}`);
}

/**
 * Pages meant to appear in search. Checks that only matter for how a page
 * shows up in results (title length, descriptions, H1, canonical, social
 * tags) skip noindex pages — e.g. contentbloom.com's 74 deliberately
 * noindexed category archives were otherwise flagged ~5 times each.
 */
const searchable = (pages: CheckablePage[]) => pages.filter((p) => !isNoindex(p.onPage));

/** True if the page declares a different URL as canonical (a declared duplicate). */
function canonicalisedElsewhere(p: CheckablePage): boolean {
  return Boolean(p.onPage.canonical) && urlKey(p.onPage.canonical!) !== urlKey(p.finalUrl);
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

function finding(f: Omit<Finding, "category">): Finding | null {
  return f.urls.length > 0 ? { ...f, category: "onpage" } : null;
}

// ---------------------------------------------------------------- titles

function missingTitle({ pages }: Context) {
  return finding({
    id: "title-missing",
    title: "Missing page title",
    severity: "error",
    description: "These pages have no <title>, or an empty one. The title is the headline search engines show for a page.",
    urls: pages.filter((p) => !p.title).map((p) => p.finalUrl),
  });
}

function multipleTitles({ pages }: Context) {
  const hits = pages.filter((p) => p.onPage.titleCount > 1);
  return finding({
    id: "title-multiple",
    title: "More than one <title> tag",
    severity: "warning",
    description: "Each page should have exactly one title. Search engines may pick either.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, count(p.onPage.titleCount, "title tag")])),
  });
}

function longTitle({ pages }: Context) {
  pages = searchable(pages);
  const hits = pages.filter((p) => (p.title?.length ?? 0) > TITLE_MAX_CHARS);
  return finding({
    id: "title-long",
    title: "Titles that may be truncated",
    severity: "warning",
    description: `Longer than ${TITLE_MAX_CHARS} characters, so search results may cut them off. (Google truncates by pixel width, so treat this as a guide.)`,
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, `${p.title!.length} characters`])),
  });
}

function hasQuery(url: string): boolean {
  try {
    return new URL(url).search.length > 0;
  } catch {
    return false;
  }
}

/**
 * Pages sharing the same text. Excludes noindex pages, declared duplicates
 * (canonical elsewhere) and URLs with a query string — filter/sort variants
 * like /blog?tag=x naturally share the base page's title, and flagging them
 * is noise (same rule as "missing from sitemap").
 */
function duplicates(pages: CheckablePage[], text: (p: CheckablePage) => string | null) {
  const groups = new Map<string, CheckablePage[]>();
  for (const p of pages) {
    const t = text(p);
    if (!t || isNoindex(p.onPage) || canonicalisedElsewhere(p) || hasQuery(p.finalUrl)) continue;
    const key = t.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(p);
  }
  const urls: string[] = [];
  const notes: Record<string, string> = {};
  for (const [, g] of [...groups].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length)) {
    const sample = text(g[0])!;
    const label = `Shared by ${g.length} pages: “${sample.length > 70 ? `${sample.slice(0, 67)}…` : sample}”`;
    for (const p of g) {
      urls.push(p.finalUrl);
      notes[p.finalUrl] = label;
    }
  }
  return { urls, notes };
}

function duplicateTitles({ pages }: Context) {
  const { urls, notes } = duplicates(pages, (p) => p.title);
  return finding({
    id: "title-duplicate",
    title: "Duplicate titles",
    severity: "warning",
    description: "Several pages share the same title, so search engines (and people scanning results) can't tell them apart. Pages that are noindex, point their canonical elsewhere, or have a query string (filters like ?tag=) aren't counted.",
    urls,
    notes,
  });
}

// ---------------------------------------------------------- descriptions

function missingDescription({ pages }: Context) {
  pages = searchable(pages);
  return finding({
    id: "description-missing",
    title: "Missing meta description",
    severity: "warning",
    description: "Without one, search engines write their own snippet from the page text.",
    urls: pages.filter((p) => !p.onPage.metaDescription).map((p) => p.finalUrl),
  });
}

function multipleDescriptions({ pages }: Context) {
  const hits = pages.filter((p) => p.onPage.metaDescriptionCount > 1);
  return finding({
    id: "description-multiple",
    title: "More than one meta description",
    severity: "warning",
    description: "Each page should have one meta description. Search engines may ignore them all.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, count(p.onPage.metaDescriptionCount, "description")])),
  });
}

function longDescription({ pages }: Context) {
  pages = searchable(pages);
  const hits = pages.filter((p) => (p.onPage.metaDescription?.length ?? 0) > DESCRIPTION_MAX_CHARS);
  return finding({
    id: "description-long",
    title: "Meta descriptions that may be truncated",
    severity: "warning",
    description: `Longer than ${DESCRIPTION_MAX_CHARS} characters, so search results may cut them off. (A guide, not a hard limit.)`,
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, `${p.onPage.metaDescription!.length} characters`])),
  });
}

function duplicateDescriptions({ pages }: Context) {
  const { urls, notes } = duplicates(pages, (p) => p.onPage.metaDescription);
  return finding({
    id: "description-duplicate",
    title: "Duplicate meta descriptions",
    severity: "warning",
    description: "Several pages share the same meta description. Pages that are noindex, point their canonical elsewhere, or have a query string aren't counted.",
    urls,
    notes,
  });
}

// ------------------------------------------------------------- headings

function missingH1({ pages }: Context) {
  pages = searchable(pages);
  const hits = pages.filter((p) => p.onPage.h1s.every((h) => !h));
  return finding({
    id: "h1-missing",
    title: "Missing H1 heading",
    severity: "warning",
    description: "These pages have no H1, or only empty ones. The H1 is the page's main on-page heading.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(
      hits.filter((p) => p.onPage.h1s.length > 0).map((p) => [p.finalUrl, "H1 is empty"])
    ),
  });
}

function multipleH1({ pages }: Context) {
  const hits = pages.filter((p) => p.onPage.h1s.filter(Boolean).length > 1);
  return finding({
    id: "h1-multiple",
    title: "More than one H1 heading",
    severity: "info",
    description: "Not an error, but one clear main heading per page is the convention.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, count(p.onPage.h1s.filter(Boolean).length, "H1")])),
  });
}

// ------------------------------------------------------------ canonical

function missingCanonical({ pages }: Context) {
  pages = searchable(pages);
  return finding({
    id: "canonical-missing",
    title: "No canonical tag",
    severity: "info",
    description: "Recommended rather than required: a canonical tag tells search engines which URL is the main version of a page.",
    urls: pages.filter((p) => !p.onPage.canonical).map((p) => p.finalUrl),
  });
}

function multipleCanonicals({ pages }: Context) {
  const hits = pages.filter((p) => p.onPage.canonicalCount > 1);
  return finding({
    id: "canonical-multiple",
    title: "More than one canonical tag",
    severity: "warning",
    description: "Conflicting canonical tags are usually ignored altogether.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, count(p.onPage.canonicalCount, "canonical tag")])),
  });
}

function canonicalWrongHost({ audit, pages }: Context) {
  // Same page, but the canonical names another host/protocol (www vs apex,
  // http vs https). urlKey() treats those as the same, so compare directly.
  const hits = pages.filter((p) => {
    const c = p.onPage.canonical;
    if (!c || urlKey(c) !== urlKey(p.finalUrl)) return false;
    try {
      const cu = new URL(c);
      const fu = new URL(p.finalUrl);
      return cu.host !== fu.host || cu.protocol !== fu.protocol;
    } catch {
      return false;
    }
  });
  const site = new URL(audit.discovery.origin);
  return finding({
    id: "canonical-wrong-host",
    title: "Canonical uses a different host or protocol",
    severity: "warning",
    description: `The site serves from ${site.protocol}//${site.host}, but these pages' canonical tags point at another host or protocol — which then redirects.`,
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, `→ ${p.onPage.canonical}`])),
  });
}

function canonicalOffSite({ audit, pages }: Context) {
  // Found on velocity-b.com, 2026-10-11: paginated blog pages declared their
  // canonical on the site's *.vercel.app preview domain. Search engines may
  // then treat that domain as the real copy — high impact, so an error.
  const hits = pages.filter(
    (p) => p.onPage.canonical && !isSameSite(p.onPage.canonical, audit.discovery.origin)
  );
  return finding({
    id: "canonical-off-site",
    title: "Canonical points to another domain",
    severity: "error",
    description: "These pages tell search engines the main version lives on a different domain, so this site's copy may be dropped from results. Often a staging or preview URL left in the site's config.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, `→ ${p.onPage.canonical}`])),
  });
}

function canonicalElsewhere({ audit, pages }: Context) {
  // Off-site canonicals are reported by canonicalOffSite instead.
  const hits = pages.filter(
    (p) => canonicalisedElsewhere(p) && isSameSite(p.onPage.canonical!, audit.discovery.origin)
  );
  return finding({
    id: "canonical-elsewhere",
    title: "Canonical points to a different page",
    severity: "info",
    description: "These pages tell search engines another URL is the main version, so they're unlikely to appear in results themselves. Normal for filtered or paginated views; worth checking otherwise.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, `→ ${shortPath(p.onPage.canonical!)}`])),
  });
}

function canonicalBroken({ audit, pages, byKey }: Context) {
  const notes: Record<string, string> = {};
  const urls: string[] = [];
  for (const p of pages) {
    const c = p.onPage.canonical;
    if (!c || !isSameSite(c, audit.discovery.origin)) continue;
    // Only judge targets we actually crawled; anything else is unknown, not broken.
    const target = byKey.get(urlKey(c));
    if (!target || target === p) continue;
    if (target.status === 0 || target.status >= 400) {
      urls.push(p.finalUrl);
      notes[p.finalUrl] = `→ ${shortPath(c)} (${target.status || "failed"})`;
    } else if (target.redirectChain.length > 0 && urlKey(target.finalUrl) !== urlKey(c)) {
      urls.push(p.finalUrl);
      notes[p.finalUrl] = `→ ${shortPath(c)} redirects`;
    }
  }
  return finding({
    id: "canonical-broken",
    title: "Canonical points to a broken or redirected page",
    severity: "warning",
    description: "The canonical target should be a working, final URL. Only targets that were crawled are checked.",
    urls,
    notes,
  });
}

// --------------------------------------------------------------- noindex

function noindexPages({ pages }: Context) {
  const hits = pages.filter((p) => isNoindex(p.onPage));
  return finding({
    id: "noindex",
    title: "Pages excluded from search (noindex)",
    severity: "info",
    description: "These pages ask search engines not to index them. Usually deliberate (thank-you pages, internal search) — listed so an accidental one stands out. Checks that only affect search listings (descriptions, title length, H1, canonical, social tags) are skipped for these pages.",
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(
      hits.map((p) => [
        p.finalUrl,
        p.onPage.metaRobots && /\b(noindex|none)\b/.test(p.onPage.metaRobots)
          ? `robots meta: ${p.onPage.metaRobots}`
          : `X-Robots-Tag: ${p.onPage.xRobotsTag}`,
      ])
    ),
  });
}

function noindexInSitemap({ pages }: Context) {
  return finding({
    id: "noindex-in-sitemap",
    title: "noindex pages listed in the sitemap",
    severity: "warning",
    description: "The sitemap asks search engines to index these pages while the pages themselves say not to. Remove them from the sitemap, or drop the noindex.",
    urls: pages.filter((p) => p.inSitemap && isNoindex(p.onPage)).map((p) => p.finalUrl),
  });
}

// ------------------------------------------------------- everything else

function missingLang({ pages }: Context) {
  return finding({
    id: "lang-missing",
    title: "No page language set",
    severity: "warning",
    description: "The <html> element has no lang attribute. It helps search engines and screen readers handle the page's language.",
    urls: pages.filter((p) => !p.onPage.lang).map((p) => p.finalUrl),
  });
}

function missingOpenGraph({ pages }: Context) {
  pages = searchable(pages);
  const notes: Record<string, string> = {};
  for (const p of pages) {
    const missing = [
      !p.onPage.ogTitle && "og:title",
      !p.onPage.ogDescription && "og:description",
      !p.onPage.ogImage && "og:image",
    ].filter(Boolean);
    if (missing.length) notes[p.finalUrl] = `Missing ${missing.join(", ")}`;
  }
  return finding({
    id: "og-missing",
    title: "Missing social sharing tags",
    severity: "warning",
    description: "Open Graph tags control the title, description and image shown when a page is shared on LinkedIn, Slack and elsewhere.",
    urls: Object.keys(notes),
    notes,
  });
}

function imagesMissingAlt({ pages }: Context) {
  const hits = pages.filter((p) => p.onPage.imagesMissingAlt > 0);
  return finding({
    id: "img-alt-missing",
    title: "Images without alt text",
    severity: "warning",
    description: 'These pages have images with no alt attribute at all. (alt="" is fine for decorative images and isn\'t counted.)',
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(
      hits.map((p) => [p.finalUrl, `${p.onPage.imagesMissingAlt} of ${count(p.onPage.imageCount, "image")}`])
    ),
  });
}

function slowPages({ pages }: Context) {
  const hits = pages.filter((p) => p.timeMs > SLOW_RESPONSE_MS).sort((a, b) => b.timeMs - a.timeMs);
  return finding({
    id: "slow",
    title: "Slow server responses",
    severity: "warning",
    description: `Took over ${SLOW_RESPONSE_MS / 1000}s to return the page's HTML. Measured from Mediasurface's server, so distance and a one-off blip can play a part — rerun before acting on a single slow page.`,
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(hits.map((p) => [p.finalUrl, `${p.timeMs.toLocaleString("en-GB")} ms`])),
  });
}

function largePages({ pages }: Context) {
  const hits = pages.filter((p) => p.sizeBytes > LARGE_HTML_BYTES || p.truncated);
  return finding({
    id: "large",
    title: "Very large HTML",
    severity: "info",
    description: `The HTML alone is over ${LARGE_HTML_BYTES / 1024} KB (images and scripts not included), which slows the first load, especially on mobile.`,
    urls: hits.map((p) => p.finalUrl),
    notes: Object.fromEntries(
      hits.map((p) => [
        p.finalUrl,
        p.truncated ? "Over 5 MB (stopped reading)" : `${Math.round(p.sizeBytes / 1024).toLocaleString("en-GB")} KB`,
      ])
    ),
  });
}

const CHECKS = [
  missingTitle,
  multipleTitles,
  longTitle,
  duplicateTitles,
  missingDescription,
  multipleDescriptions,
  longDescription,
  duplicateDescriptions,
  missingH1,
  multipleH1,
  missingCanonical,
  multipleCanonicals,
  canonicalWrongHost,
  canonicalOffSite,
  canonicalElsewhere,
  canonicalBroken,
  noindexPages,
  noindexInSitemap,
  missingLang,
  missingOpenGraph,
  imagesMissingAlt,
  slowPages,
  largePages,
];

export function onPageFindings(audit: AuditResult): Finding[] {
  const { origin } = audit.discovery;
  const byKey = new Map<string, AuditPage>();
  const pages: CheckablePage[] = [];
  const seen = new Set<string>();
  for (const p of audit.pages) {
    const key = urlKey(p.finalUrl);
    if (!byKey.has(key)) byKey.set(key, p);
    // Also index by the requested URL, so a canonical pointing at a URL that
    // redirects finds the redirecting page.
    const requested = urlKey(p.url);
    if (!byKey.has(requested)) byKey.set(requested, p);
    // Several crawled URLs can land on the same final page (redirects);
    // check each final page once so duplicates aren't double-counted.
    if (seen.has(key) || !p.onPage || p.status !== 200 || !p.isHtml) continue;
    if (!isSameSite(p.finalUrl, origin)) continue;
    seen.add(key);
    pages.push(p as CheckablePage);
  }
  const ctx: Context = { audit, pages, byKey };
  return CHECKS.map((check) => check(ctx)).filter((f): f is Finding => f !== null);
}
