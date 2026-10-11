/**
 * Phase 4: structured data (JSON-LD) checks. Pure, no extra requests.
 *
 * Deliberately NOT full schema.org validation — that's what Google's Rich
 * Results Test is for, and the report points there. This catches the
 * common, fixable problems: JSON that doesn't parse, and the handful of
 * properties each common type needs to be useful.
 */

import { isSameSite, urlKey } from "../urls";
import type { AuditPage, AuditResult, OnPageData } from "../types";
import type { Finding } from "./types";

type Rule = { all?: string[]; anyOf?: string[][] };

/** Key properties per type. A type here is checked; anything else is just counted. */
const RULES: Record<string, Rule> = {
  Article: { all: ["headline", "datePublished", "author", "image"] },
  BlogPosting: { all: ["headline", "datePublished", "author", "image"] },
  NewsArticle: { all: ["headline", "datePublished", "author", "image"] },
  TechArticle: { all: ["headline", "datePublished", "author", "image"] },
  Organization: { all: ["name", "url", "logo"] },
  Corporation: { all: ["name", "url", "logo"] },
  LocalBusiness: { all: ["name", "address"] },
  ProfessionalService: { all: ["name", "address"] },
  WebSite: { all: ["name", "url"] },
  BreadcrumbList: { all: ["itemListElement"] },
  FAQPage: { all: ["mainEntity"] },
  Product: { all: ["name"], anyOf: [["offers", "review", "aggregateRating"]] },
  Event: { all: ["name", "startDate", "location"] },
  VideoObject: { all: ["name", "thumbnailUrl", "uploadDate"] },
  Person: { all: ["name"] },
};

const RICH_RESULTS_TEST = "https://search.google.com/test/rich-results";

function missingFor(types: string[], keys: string[]): { type: string; missing: string[] } | null {
  for (const t of types) {
    const rule = RULES[t];
    if (!rule) continue;
    const missing = (rule.all ?? []).filter((k) => !keys.includes(k));
    for (const group of rule.anyOf ?? []) {
      if (!group.some((k) => keys.includes(k))) missing.push(group.join(" or "));
    }
    return missing.length ? { type: t, missing } : null;
  }
  return null;
}

type Checkable = AuditPage & { onPage: OnPageData };

export function schemaFindings(audit: AuditResult): Finding[] {
  const { origin } = audit.discovery;
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const pages: Checkable[] = [];
  for (const p of audit.pages) {
    const key = urlKey(p.finalUrl);
    if (seen.has(key) || !p.onPage?.structuredData || p.status !== 200 || !isSameSite(p.finalUrl, origin)) continue;
    seen.add(key);
    pages.push(p as Checkable);
  }
  if (pages.length === 0) return findings;

  // ---------------------------------------------------- doesn't parse
  const broken = pages.filter((p) => p.onPage.structuredData.parseErrors.length > 0);
  if (broken.length) {
    findings.push({
      id: "schema-invalid",
      title: "Structured data that doesn't parse",
      severity: "error",
      category: "schema",
      description:
        "These pages have JSON-LD blocks that aren't valid JSON, so search engines ignore them completely (usually a stray comma, quote or unescaped character).",
      urls: broken.map((p) => p.finalUrl),
      notes: Object.fromEntries(broken.map((p) => [p.finalUrl, p.onPage.structuredData.parseErrors[0]])),
    });
  }

  // -------------------------------------------- missing key properties
  const notes: Record<string, string> = {};
  for (const p of pages) {
    const problems = p.onPage.structuredData.items
      .map((it) => missingFor(it.types, it.keys))
      .filter((x): x is { type: string; missing: string[] } => x !== null);
    if (problems.length) notes[p.finalUrl] = problems.map((x) => `${x.type}: missing ${x.missing.join(", ")}`).join(" · ");
  }
  if (Object.keys(notes).length) {
    findings.push({
      id: "schema-incomplete",
      title: "Structured data missing key properties",
      severity: "warning",
      category: "schema",
      description: `These pages use common schema types without the properties search engines need to show rich results (e.g. an article without a date or image). Check details with Google's Rich Results Test: ${RICH_RESULTS_TEST}`,
      urls: Object.keys(notes),
      notes,
    });
  }

  // ------------------------------------------------- site-level summary
  const typeCounts = new Map<string, number>();
  let pagesWithAny = 0;
  for (const p of pages) {
    const sd = p.onPage.structuredData;
    const types = new Set([...sd.items.flatMap((i) => i.types), ...sd.microdataTypes]);
    if (types.size || sd.rdfaCount) pagesWithAny++;
    for (const t of types) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }

  if (pagesWithAny === 0) {
    findings.push({
      id: "schema-none",
      title: "No structured data found",
      severity: "info",
      category: "schema",
      description:
        "No JSON-LD, microdata or RDFa on any crawled page. Structured data (e.g. Organization on the homepage, Article on blog posts) helps search engines and AI assistants understand the site and can unlock rich results.",
      urls: [],
    });
    return findings;
  }

  const summary = [...typeCounts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t, n]) => `${t} ×${n}`)
    .join(", ");
  findings.push({
    id: "schema-summary",
    title: "Structured data on this site",
    severity: "info",
    category: "schema",
    description: `Found on ${pagesWithAny} of ${pages.length} pages: ${summary || "RDFa only"}. Each page's types are shown in its row details in the page inventory.`,
    urls: [],
  });

  const home = pages.find((p) => urlKey(p.finalUrl) === urlKey(audit.discovery.startUrl));
  if (home) {
    const homeTypes = new Set(home.onPage.structuredData.items.flatMap((i) => i.types));
    const hasOrg = [...homeTypes].some((t) => ["Organization", "Corporation", "LocalBusiness", "ProfessionalService", "WebSite"].includes(t));
    if (!hasOrg) {
      findings.push({
        id: "schema-home-no-org",
        title: "Homepage has no Organization or WebSite markup",
        severity: "info",
        category: "schema",
        description:
          "Organization (name, logo, social profiles) and WebSite markup on the homepage are the usual foundation — they tell search engines and AI assistants who's behind the site.",
        urls: [home.finalUrl],
      });
    }
  }

  return findings;
}
