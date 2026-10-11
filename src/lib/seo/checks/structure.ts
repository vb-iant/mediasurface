/**
 * Phase 4: site-structure checks. Pure, no extra requests — they read
 * redirect chains, depth and inlink counts the crawler already records.
 */

import { isSameSite, urlKey } from "../urls";
import type { AuditPage, AuditResult } from "../types";
import { isNoindex } from "./on-page";
import type { Finding, LinkSource } from "./types";

/** Pages deeper than this many clicks from the start page are flagged. */
export const MAX_CLICK_DEPTH = 3;

const HOME_VARIANTS = /^\/(index\.(html?|php|aspx?)|home|default\.aspx?)?$/i;

function homeKey(audit: AuditResult): string {
  return urlKey(new URL("/", audit.discovery.origin).toString());
}

function isHomeVariant(url: string, origin: string): boolean {
  try {
    const u = new URL(url);
    return isSameSite(url, origin) && HOME_VARIANTS.test(u.pathname.replace(/\/+$/, "") || "/");
  } catch {
    return false;
  }
}

/** Indexable = loads (200), HTML, on this site, not noindex. */
function indexable(p: AuditPage, origin: string): boolean {
  return (
    p.status === 200 &&
    p.isHtml &&
    p.redirectChain.length === 0 &&
    isSameSite(p.finalUrl, origin) &&
    !(p.onPage && isNoindex(p.onPage))
  );
}

/** Sitemap/pagination URLs that naturally have one inlink. */
function isPaginated(url: string): boolean {
  try {
    const u = new URL(url);
    return u.search.length > 0 || /\/page\/\d+\/?$/i.test(u.pathname) || /\/\d+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** URLs → pages linking to them, with link text. */
function sourcesFor(pages: AuditPage[], keys: Set<string>): Map<string, LinkSource[]> {
  const out = new Map<string, LinkSource[]>();
  for (const p of pages) {
    if (p.status >= 400 || !p.isHtml) continue;
    for (const l of p.internalLinks) {
      const k = urlKey(l);
      if (!keys.has(k)) continue;
      let list = out.get(k);
      if (!list) out.set(k, (list = []));
      if (!list.some((s) => s.page === p.finalUrl)) list.push({ page: p.finalUrl, text: p.linkText?.[l] ?? "" });
    }
  }
  return out;
}

/** True if a URL redirects (one or more hops) to the site's homepage. */
export function redirectsToHome(p: { url: string; finalUrl: string; redirectChain?: unknown[] }, audit: AuditResult): boolean {
  const { origin } = audit.discovery;
  return (
    (p.redirectChain?.length ?? 1) > 0 &&
    urlKey(p.finalUrl) === homeKey(audit) &&
    !isHomeVariant(p.url, origin) &&
    urlKey(p.url) !== homeKey(audit)
  );
}

export function structureFindings(audit: AuditResult): Finding[] {
  const { origin } = audit.discovery;
  const findings: Finding[] = [];
  const provisional = audit.capReached || audit.status !== "complete";
  const caveat = provisional
    ? "The crawl didn't reach every page, so depth and link counts are provisional."
    : undefined;

  // ------------------------------------------- redirects to the homepage
  // Found on contentbloom.com: ~220 old archive URLs 301 to the homepage.
  // Google treats a redirect to an unrelated homepage like a missing page.
  const homeRedirects = audit.pages.filter((p) => isSameSite(p.url, origin) && redirectsToHome(p, audit));
  const assetHome = (audit.linkCheck?.results ?? []).filter(
    (r) => r.kind === "asset" && r.verdict === "ok" && urlKey(r.finalUrl) === homeKey(audit) && !isHomeVariant(r.url, origin)
  );
  if (homeRedirects.length || assetHome.length) {
    const keys = new Set(homeRedirects.map((p) => urlKey(p.url)));
    const srcs = sourcesFor(audit.pages, keys);
    const urls = [...homeRedirects.map((p) => p.url), ...assetHome.map((r) => r.url)];
    findings.push({
      id: "redirect-to-home",
      title: "Redirects to the homepage",
      severity: "warning",
      category: "status",
      description:
        "These URLs redirect to the homepage instead of a matching page. Search engines treat that like a missing page (a \"soft 404\"), and visitors land somewhere unexpected. Redirect each to its closest equivalent, or let it return 404/410 and update the links.",
      urls,
      notes: Object.fromEntries([
        ...homeRedirects.map((p) => {
          const n = srcs.get(urlKey(p.url))?.length ?? 0;
          const where = n ? `linked from ${n} page${n === 1 ? "" : "s"}` : p.inSitemap ? "in the sitemap" : "not linked";
          return [p.url, `${p.redirectChain[0]?.status ?? 301} → / · ${where}`];
        }),
        ...assetHome.map((r) => [r.url, "File → homepage"]),
      ]),
      sources: Object.fromEntries(homeRedirects.map((p) => [p.url, (srcs.get(urlKey(p.url)) ?? []).slice(0, 20)])),
    });
  }

  // ------------------------------------------------------- click depth
  const deep = audit.pages
    .filter((p) => indexable(p, origin) && p.depth !== null && p.depth > MAX_CLICK_DEPTH)
    .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
  if (deep.length) {
    findings.push({
      id: "deep-pages",
      title: `Pages more than ${MAX_CLICK_DEPTH} clicks deep`,
      severity: "warning",
      category: "structure",
      description: `These pages take more than ${MAX_CLICK_DEPTH} clicks to reach from the start page. Search engines crawl and value deeply buried pages less, and visitors rarely find them. Link to them from higher-level pages (navigation, hubs, related content).`,
      urls: deep.map((p) => p.finalUrl),
      notes: Object.fromEntries(deep.map((p) => [p.finalUrl, `${p.depth} clicks deep`])),
      caveat,
    });
  }

  // ------------------------------------------------- weak internal links
  const startKey = urlKey(audit.discovery.startUrl);
  const weak = audit.pages.filter(
    (p) =>
      indexable(p, origin) &&
      p.depth !== null &&
      p.inlinkCount === 1 &&
      urlKey(p.finalUrl) !== startKey &&
      !isPaginated(p.finalUrl)
  );
  if (weak.length) {
    const keys = new Set(weak.map((p) => urlKey(p.finalUrl)));
    const srcs = sourcesFor(audit.pages, keys);
    findings.push({
      id: "single-inlink",
      title: "Pages with only one internal link",
      severity: "info",
      category: "structure",
      description:
        "Only one other page links to each of these (pagination and filtered URLs aren't counted). More internal links help search engines judge a page's importance and help visitors find it.",
      urls: weak.map((p) => p.finalUrl),
      sources: Object.fromEntries(weak.map((p) => [p.finalUrl, srcs.get(urlKey(p.finalUrl)) ?? []])),
      caveat,
    });
  }

  return findings;
}
