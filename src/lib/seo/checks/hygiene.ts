/**
 * Phase 4: page hygiene — viewport, mixed content, URL hygiene, thin pages,
 * hreflang. Pure, from HTML already fetched. Indexable pages only (noindex
 * pages skipped, as in phase 2).
 */

import { isSameSite, urlKey } from "../urls";
import type { AuditPage, AuditResult, OnPageData } from "../types";
import { isNoindex } from "./on-page";
import type { Finding } from "./types";

export const THIN_WORDS = 200;
export const MAX_URL_LENGTH = 115;

type Checkable = AuditPage & { onPage: OnPageData };

function indexablePages(audit: AuditResult): Checkable[] {
  const { origin } = audit.discovery;
  const seen = new Set<string>();
  const out: Checkable[] = [];
  for (const p of audit.pages) {
    const k = urlKey(p.finalUrl);
    if (seen.has(k) || !p.onPage || p.status !== 200 || !p.isHtml || !isSameSite(p.finalUrl, origin)) continue;
    if (isNoindex(p.onPage)) continue;
    seen.add(k);
    out.push(p as Checkable);
  }
  return out;
}

/** Filtered/paginated views (?tag=…, /page/2) — naturally thin, not real pages to judge. */
function isListingVariant(url: string): boolean {
  try {
    const u = new URL(url);
    return u.search.length > 0 || /\/page\/\d+\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;

export function hygieneFindings(audit: AuditResult): Finding[] {
  const pages = indexablePages(audit);
  const findings: Finding[] = [];
  if (!pages.length) return findings;

  const noViewport = pages.filter((p) => !p.onPage.hasViewport);
  if (noViewport.length) {
    findings.push({
      id: "viewport-missing",
      title: "No mobile viewport tag",
      severity: "warning",
      category: "onpage",
      description:
        'These pages have no <meta name="viewport">, so phones render them as a shrunken desktop page. Google indexes the mobile version of pages, so this affects rankings too.',
      urls: noViewport.map((p) => p.finalUrl),
    });
  }

  const mixed = pages.filter((p) => p.onPage.mixedContentCount > 0);
  if (mixed.length) {
    findings.push({
      id: "mixed-content",
      title: "Insecure content on secure pages",
      severity: "warning",
      category: "onpage",
      description:
        "These https pages load images, scripts, stylesheets or frames over plain http. Browsers block or flag these (\"not secure\"), so they may not show at all.",
      urls: mixed.map((p) => p.finalUrl),
      notes: Object.fromEntries(
        mixed.map((p) => [
          p.finalUrl,
          `${p.onPage.mixedContentCount} insecure resource${p.onPage.mixedContentCount === 1 ? "" : "s"}, e.g. ${p.onPage.mixedContent[0]}`,
        ])
      ),
    });
  }

  const urlNotes: Record<string, string> = {};
  for (const p of pages) {
    let u: URL;
    try {
      u = new URL(p.finalUrl);
    } catch {
      continue;
    }
    const issues: string[] = [];
    if (/[A-Z]/.test(u.pathname)) issues.push("capital letters");
    if (u.pathname.includes("_")) issues.push("underscores");
    if (/\/\/./.test(u.pathname)) issues.push("double slash");
    if (p.finalUrl.length > MAX_URL_LENGTH) issues.push(`${p.finalUrl.length} characters long`);
    if (issues.length) urlNotes[p.finalUrl] = issues.join(", ");
  }
  if (Object.keys(urlNotes).length) {
    findings.push({
      id: "url-hygiene",
      title: "Untidy URLs",
      severity: "info",
      category: "onpage",
      description: `URLs work best lower-case, hyphen-separated and short (under ${MAX_URL_LENGTH} characters). Capitals can create duplicate URLs on some servers; underscores aren't treated as word separators. Don't rename existing URLs just for this without redirects.`,
      urls: Object.keys(urlNotes),
      notes: urlNotes,
    });
  }

  const thin = pages
    .filter((p) => p.onPage.wordCount < THIN_WORDS && !isListingVariant(p.finalUrl)).sort((a, b) => a.onPage.wordCount - b.onPage.wordCount);
  if (thin.length) {
    findings.push({
      id: "thin-pages",
      title: "Pages with very little text",
      severity: "info",
      category: "onpage",
      description: `Under ${THIN_WORDS} words of main text (navigation, header and footer aren't counted; filtered and paginated listings are skipped). Fine for contact or legal pages; for pages meant to rank, more substance usually helps.`,
      urls: thin.map((p) => p.finalUrl),
      notes: Object.fromEntries(thin.map((p) => [p.finalUrl, `${p.onPage.wordCount} words`])),
    });
  }

  // ---------------------------------------------------------- hreflang
  const withHreflang = pages.filter((p) => p.onPage.hreflang.length > 0);
  if (withHreflang.length) {
    const byKey = new Map(audit.pages.map((p) => [urlKey(p.url), p] as const));
    for (const p of audit.pages) if (!byKey.has(urlKey(p.finalUrl))) byKey.set(urlKey(p.finalUrl), p);

    const badCodes: Record<string, string> = {};
    const noReturn: Record<string, string> = {};
    const broken: Record<string, string> = {};
    for (const p of withHreflang) {
      const bad = p.onPage.hreflang.filter((h) => !HREFLANG.test(h.lang)).map((h) => h.lang);
      if (bad.length) badCodes[p.finalUrl] = `Invalid: ${[...new Set(bad)].join(", ")}`;
      const selfKey = urlKey(p.finalUrl);
      for (const h of p.onPage.hreflang) {
        const k = urlKey(h.href);
        if (k === selfKey) continue;
        const target = byKey.get(k);
        if (!target) continue; // not crawled — can't judge
        if (target.status === 0 || target.status >= 400) {
          broken[p.finalUrl] = `${h.lang} → ${h.href} (${target.status || "failed"})`;
        } else if (target.onPage && !target.onPage.hreflang.some((x) => urlKey(x.href) === selfKey)) {
          noReturn[p.finalUrl] = `${h.lang} → ${h.href} doesn't link back`;
        }
      }
    }
    if (Object.keys(badCodes).length) {
      findings.push({
        id: "hreflang-invalid",
        title: "Invalid hreflang language codes",
        severity: "warning",
        category: "onpage",
        description: 'hreflang values must be a language code, optionally with a region (e.g. "en", "en-GB", "fr-CA") or "x-default". Invalid ones are ignored.',
        urls: Object.keys(badCodes),
        notes: badCodes,
      });
    }
    if (Object.keys(noReturn).length) {
      findings.push({
        id: "hreflang-no-return",
        title: "hreflang alternates that don't link back",
        severity: "warning",
        category: "onpage",
        description: "Language alternates must reference each other. If page A lists B but B doesn't list A, search engines ignore the pair.",
        urls: Object.keys(noReturn),
        notes: noReturn,
      });
    }
    if (Object.keys(broken).length) {
      findings.push({
        id: "hreflang-broken",
        title: "hreflang alternates that don't load",
        severity: "warning",
        category: "onpage",
        description: "These pages point to language versions that return an error.",
        urls: Object.keys(broken),
        notes: broken,
      });
    }
    if (!withHreflang.some((p) => p.onPage.hreflang.some((h) => h.lang.toLowerCase() === "x-default"))) {
      findings.push({
        id: "hreflang-no-default",
        title: "No x-default hreflang",
        severity: "info",
        category: "onpage",
        description: "The site uses hreflang but never declares an x-default page — the fallback for visitors whose language isn't listed.",
        urls: [],
      });
    }
  }

  return findings;
}
