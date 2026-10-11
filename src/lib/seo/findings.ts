/**
 * Findings derived from an AuditResult. Pure — the report renders these, and
 * the later PDF will render the same ones. Never stored: always recomputed
 * from the audit, so the stored shape stays just the raw crawl data.
 */

import { isSameSite, urlKey } from "./urls";
import type { AuditPage, AuditResult } from "./types";
import { isNoindex, onPageFindings } from "./checks/on-page";
import { linkFindings } from "./checks/links";
import { redirectsToHome, structureFindings } from "./checks/structure";
import { schemaFindings } from "./checks/schema";
import type { Category, Finding, Severity } from "./checks/types";

export type { Category, Finding, LinkSource, Severity } from "./checks/types";
export { CATEGORY_LABELS } from "./checks/types";
import { CATEGORY_ORDER } from "./checks/types";

export function isOnSite(page: AuditPage, origin: string): boolean {
  return isSameSite(page.finalUrl, origin);
}

export function isBrokenPage(page: AuditPage): boolean {
  return page.status === 0 || page.status >= 400;
}

export function computeFindings(audit: AuditResult): Finding[] {
  const { discovery, pages } = audit;
  const { origin, sitemap, robots } = discovery;
  const findings: Finding[] = [];
  const incomplete =
    audit.capReached || audit.status === "cancelled" || audit.status === "error";
  const incompleteCaveat = audit.capReached
    ? `The crawl stopped at the ${audit.pageLimit.toLocaleString("en-GB")}-page limit, so some links weren't followed. Treat this list as provisional.`
    : "The crawl didn't finish, so some links weren't followed. Treat this list as provisional.";

  // Broken internal pages/files are reported by linkFindings ("Broken links").
  findings.push(...linkFindings(audit));

  const offsite = pages.filter((p) => !isOnSite(p, origin));
  if (offsite.length > 0) {
    findings.push({
      id: "offsite-redirects",
      category: "status",
      title: "Internal links that redirect off the site",
      severity: "warning",
      description: "These URLs are on this site's domain but redirect somewhere else entirely.",
      urls: offsite.map((p) => p.url),
    });
  }

  const chains = pages.filter((p) => p.redirectChain.length > 1);
  if (chains.length > 0) {
    findings.push({
      id: "redirect-chains",
      category: "status",
      title: "Redirect chains",
      severity: "warning",
      description: "These URLs take more than one redirect to reach their final page. Point links straight at the final URL.",
      urls: chains.map((p) => p.url),
    });
  }

  // Only pages actually reached by a link (depth !== null) — a sitemap-only
  // URL that redirects is reported under the sitemap findings instead.
  const redirects = pages.filter(
    (p) =>
      p.redirectChain.length === 1 &&
      isOnSite(p, origin) &&
      p.depth !== null &&
      !redirectsToHome(p, audit) // reported as "Redirects to the homepage" instead
  );
  if (redirects.length > 0) {
    findings.push({
      id: "redirects",
      category: "status",
      title: "Internal links pointing at redirects",
      severity: "info",
      description: "These URLs are linked internally but redirect once before loading. Usually harmless; updating the links saves a hop.",
      urls: redirects.map((p) => p.url),
    });
  }

  if (!robots.found || robots.error) {
    findings.push({
      id: "robots-missing",
      category: "sitemap",
      title: robots.error ? "robots.txt couldn't be read" : "No robots.txt file",
      severity: robots.error ? "warning" : "info",
      description: robots.error
        ? `${robots.url}: ${robots.error}`
        : `${robots.url} returned ${robots.status || "no response"}. Not required, but it's the standard place to point crawlers at your sitemap.`,
      urls: [],
    });
  }

  if (!sitemap.found) {
    findings.push({
      id: "sitemap-missing",
      category: "sitemap",
      title: "No XML sitemap found",
      severity: "warning",
      description:
        robots.sitemaps.length > 0
          ? "robots.txt lists a sitemap, but it couldn't be read."
          : "No sitemap was listed in robots.txt or found at /sitemap.xml or /sitemap_index.xml.",
      urls: [],
    });
  } else {
    if (robots.found && robots.sitemaps.length === 0) {
      findings.push({
        id: "sitemap-not-in-robots",
      category: "sitemap",
        title: "Sitemap not referenced in robots.txt",
        severity: "info",
        description: "A sitemap exists but robots.txt doesn't point to it with a Sitemap: line.",
        urls: [],
      });
    }

    const sitemapProblems = pages.filter(
      (p) => p.inSitemap && (isBrokenPage(p) || p.redirectChain.length > 0)
    );
    if (sitemapProblems.length > 0) {
      findings.push({
        id: "sitemap-bad-urls",
      category: "sitemap",
        title: "Sitemap URLs that don't load directly",
        severity: "warning",
        description: "A sitemap should only list final, working URLs. These return an error or redirect.",
        urls: sitemapProblems.map((p) => p.url),
        notes: Object.fromEntries(
          sitemapProblems.map((p) => [
            p.url,
            isBrokenPage(p)
              ? p.status
                ? `HTTP ${p.status}`
                : p.error ?? "No response"
              : redirectsToHome(p, audit)
                ? `${p.redirectChain[0].status} → homepage`
                : `${p.redirectChain[0].status} → ${p.finalUrl.replace(new URL(origin).origin, "") || "/"}`,
          ])
        ),
      });
    }

    // The sitemap should use the host and protocol the site actually serves
    // from. URL keys treat www/apex and http/https as the same page, so this
    // is checked directly rather than by fetching every variant.
    const siteOrigin = new URL(origin);
    const wrongHost = sitemap.urls.filter((u) => {
      try {
        const parsed = new URL(u);
        return parsed.host !== siteOrigin.host || parsed.protocol !== siteOrigin.protocol;
      } catch {
        return false;
      }
    });
    if (wrongHost.length > 0) {
      findings.push({
        id: "sitemap-wrong-host",
      category: "sitemap",
        title: "Sitemap URLs use a different host or protocol",
        severity: "warning",
        description: `The site serves from ${siteOrigin.protocol}//${siteOrigin.host}, but these sitemap URLs don't, so each one redirects. List the final URLs instead.`,
        urls: wrongHost,
      });
    }

    // Pages linked from the crawl that the sitemap doesn't list. URLs with a
    // query string (filters, sorting, tracking) are left out — they rarely
    // belong in a sitemap, and flagging them is noise.
    const unlisted = pages.filter(
      (p) =>
        isOnSite(p, origin) &&
        p.isHtml &&
        p.status === 200 &&
        !p.inSitemap &&
        p.depth !== null &&
        !new URL(p.finalUrl).search &&
        !(p.onPage && isNoindex(p.onPage))
    );
    if (unlisted.length > 0) {
      findings.push({
        id: "unlisted",
      category: "sitemap",
        title: "Pages missing from the sitemap",
        severity: "warning",
        description: "These pages are linked from the site and load fine, but aren't in the XML sitemap. (URLs with query strings and noindex pages aren't counted.)",
        urls: unlisted.map((p) => p.finalUrl),
      });
    }

    // Sitemap URLs nothing links to. The start page is excluded — it's the
    // entry point, not expected to be linked.
    const startKey = urlKey(discovery.startUrl);
    const linkedKeys = new Set<string>();
    for (const p of pages) {
      if (!isOnSite(p, origin) || p.status >= 400) continue;
      for (const l of p.internalLinks) linkedKeys.add(urlKey(l));
    }
    const finalKeyByKey = new Map(pages.map((p) => [urlKey(p.url), urlKey(p.finalUrl)]));
    const orphans = sitemap.urls.filter((u) => {
      const k = urlKey(u);
      if (k === startKey) return false;
      const fk = finalKeyByKey.get(k);
      return !linkedKeys.has(k) && !(fk && linkedKeys.has(fk));
    });
    if (orphans.length > 0) {
      findings.push({
        id: "orphans",
      category: "sitemap",
        title: "Orphan pages",
        severity: "warning",
        description: "These URLs are in the sitemap, but no crawled page links to them. Search engines and visitors can only find them via the sitemap.",
        urls: orphans,
        caveat: incomplete ? incompleteCaveat : undefined,
      });
    }

    if (sitemap.truncated) {
      findings.push({
        id: "sitemap-truncated",
      category: "sitemap",
        title: "Sitemap only partly read",
        severity: "info",
        description: "The sitemap is very large, so reading stopped early (50 sitemap files or 5,000 URLs). Sitemap comparisons cover only what was read.",
        urls: [],
      });
    }
  }

  if (audit.blockedByRobots.length > 0) {
    findings.push({
      id: "blocked-by-robots",
      category: "sitemap",
      title: "Linked pages blocked by robots.txt",
      severity: "info",
      description: "These internal URLs are linked from the site but robots.txt disallows crawling them, so they weren't checked. Fine if intentional.",
      urls: audit.blockedByRobots,
    });
  }

  findings.push(...onPageFindings(audit));
  findings.push(...structureFindings(audit));
  findings.push(...schemaFindings(audit));

  const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const categoryOrder = Object.fromEntries(CATEGORY_ORDER.map((c, i) => [c, i])) as Record<Category, number>;
  return findings.sort(
    (a, b) =>
      categoryOrder[a.category] - categoryOrder[b.category] ||
      severityOrder[a.severity] - severityOrder[b.severity]
  );
}

export function summarise(audit: AuditResult, findings: Finding[]) {
  const pages = audit.pages;
  const onSite = pages.filter((p) => isOnSite(p, audit.discovery.origin));
  const ok = onSite.filter((p) => p.status >= 200 && p.status < 300 && p.redirectChain.length === 0);
  const times = pages.filter((p) => p.status > 0).map((p) => p.timeMs).sort((a, b) => a - b);
  return {
    pagesCrawled: pages.length,
    okPages: ok.length,
    brokenPages: pages.filter(isBrokenPage).length,
    /** Broken links on this site (pages, files, images) + broken external links. */
    brokenLinks: findings
      .filter((f) => f.id === "broken-links" || f.id === "broken-external")
      .reduce((n, f) => n + f.urls.length, 0),
    redirectedPages: pages.filter((p) => p.redirectChain.length > 0).length,
    sitemapUrls: audit.discovery.sitemap.urls.length,
    medianTimeMs: times.length ? times[Math.floor(times.length / 2)] : null,
    errors: findings.filter((f) => f.severity === "error").reduce((n, f) => n + Math.max(1, f.urls.length), 0),
    warnings: findings.filter((f) => f.severity === "warning").reduce((n, f) => n + Math.max(1, f.urls.length), 0),
    notices: findings.filter((f) => f.severity === "info").reduce((n, f) => n + Math.max(1, f.urls.length), 0),
  };
}
