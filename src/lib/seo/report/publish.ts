/**
 * The published client report: a frozen snapshot of one finished audit,
 * shaped for the client viewer at tools.velocity-b.com (separate repo,
 * `vb-iant/velocity-b-tools`). Decided with Ian 2026-10-14 — see CLAUDE.md
 * "Client report publishing".
 *
 * Pure (no React, no DOM), built in the browser from the audit already in
 * the tab, the same way the PDF and workbook are. Unlike the PDF it keeps
 * EVERY affected URL per finding, because the viewer is where clients drill
 * down instead of opening the spreadsheet.
 *
 * **This is a data contract shared with another repo.** The viewer has a
 * copy of these types (`src/lib/report-types.ts` there). Changing a field
 * means bumping PUBLISHED_REPORT_VERSION and teaching the viewer the new
 * shape — reports already published keep their old version forever.
 */

import type { AuditResult, AuditPage } from "@/lib/seo/types";
import { computeFindings, type Finding, type Severity } from "@/lib/seo/findings";
import { urlKey } from "@/lib/seo/urls";
import { formatCls, formatMs, rate, type Rating } from "@/lib/seo/speed";
import { STAGES, type StageId, type StageMetric, type StageStatus } from "@/app/admin/(protected)/seo/stages";
import { guidanceFor } from "@/lib/seo/guidance";
import { buildReportModel, hostOf, type AuditPhaseLike, type ReportSpeed } from "./model";
import { VELOCITY_B_BRAND } from "./brand";

export const PUBLISHED_REPORT_VERSION = 1;

/** Sources kept per URL (link findings list the pages linking to it). */
const MAX_SOURCES_PER_URL = 10;

export interface PublishedItem {
  url: string;
  note?: string;
  sources?: { page: string; text: string }[];
  /** Total linking pages when more than MAX_SOURCES_PER_URL were found. */
  sourceCount?: number;
}

export interface PublishedFinding {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  caveat?: string;
  why?: string;
  how?: string;
  guideUrl: string | null;
  /** Affected URLs (0 = site-wide finding). */
  count: number;
  items: PublishedItem[];
}

export interface PublishedSection {
  id: StageId;
  title: string;
  blurb: string;
  status: StageStatus;
  metrics: StageMetric[];
  counts: Record<Severity, number>;
  findings: PublishedFinding[];
}

export interface PublishedPage {
  url: string;
  /** HTTP status; 0 = no response (see `error`). */
  status: number;
  error?: string;
  /** Where it redirected to, when it did. */
  finalUrl?: string;
  depth: number | null;
  inSitemap: boolean;
  inlinks: number;
  /** null when the page wasn't HTML we could read. */
  indexable: boolean | null;
  title: string;
  metaDescription: string;
  h1: string;
  wordCount: number | null;
  timeMs: number;
  /** Ids of the findings that list this page. */
  issues: string[];
}

export interface PublishedSpeedRow {
  url: string;
  template: string;
  templatePages: number;
  reason?: string;
  score: number | null;
  scoreRating: Rating | null;
  lcp: string;
  lcpRating: Rating | null;
  cls: string;
  tbt: string;
  error: string | null;
}

export interface PublishedReport {
  version: typeof PUBLISHED_REPORT_VERSION;
  site: { host: string; startUrl: string; origin: string };
  audit: {
    startedAt: string;
    finishedAt: string | null;
    durationText: string;
    pageLimit: number;
    pagesCrawled: number;
    checkExternal: boolean;
    /** Why the audit is partial; empty when it ran to completion. */
    partial: string[];
  };
  totals: { errors: number; warnings: number; notices: number; brokenLinks: number; pagesCrawled: number; okPages: number };
  /** Ids of the worst findings, in order (errors/warnings only, max 5). */
  topIssues: string[];
  sections: PublishedSection[];
  speed: (ReportSpeed & { rows: PublishedSpeedRow[] }) | null;
  coverage: { title: string; line: string; caveat?: string }[];
  method: string[];
  pages: PublishedPage[];
}

function isIndexable(p: AuditPage): boolean | null {
  if (!p.onPage) return null;
  const robots = `${p.onPage.metaRobots ?? ""} ${p.onPage.xRobotsTag ?? ""}`;
  return !/noindex/.test(robots);
}

function itemsOf(f: Finding): PublishedItem[] {
  return f.urls.map((url) => {
    const item: PublishedItem = { url };
    const note = f.notes?.[url];
    if (note) item.note = note;
    const sources = f.sources?.[url];
    if (sources?.length) {
      item.sources = sources.slice(0, MAX_SOURCES_PER_URL).map((s) => ({ page: s.page, text: s.text }));
      if (sources.length > MAX_SOURCES_PER_URL) item.sourceCount = sources.length;
    }
    return item;
  });
}

export function buildPublishedReport(
  audit: AuditResult,
  phase: AuditPhaseLike,
  options: { checkExternal: boolean },
  findings: Finding[] = computeFindings(audit)
): PublishedReport {
  // The PDF model already works out sections, ordering, guidance, speed and
  // partial reasons; reuse it so the PDF and the viewer never disagree, and
  // swap its 5-example lists for every URL.
  const model = buildReportModel(audit, phase, options, VELOCITY_B_BRAND, findings);
  const byId = new Map(findings.map((f) => [f.id, f]));

  const sections: PublishedSection[] = model.sections.map((s) => ({
    id: s.id,
    title: s.title,
    blurb: s.blurb,
    status: s.status,
    metrics: s.metrics,
    counts: s.counts,
    findings: s.findings.map((rf) => {
      const f = byId.get(rf.id);
      const out: PublishedFinding = {
        id: rf.id,
        title: rf.title,
        severity: rf.severity,
        description: rf.description,
        guideUrl: rf.guideUrl,
        count: rf.count,
        items: f ? itemsOf(f) : [],
      };
      if (rf.caveat) out.caveat = rf.caveat;
      if (rf.why) out.why = rf.why;
      if (rf.how) out.how = rf.how;
      return out;
    }),
  }));

  // Page → finding ids (issues only; "about the audit" notes aren't page problems).
  const issuesByUrl = new Map<string, string[]>();
  for (const f of findings) {
    if (guidanceFor(f.id)?.kind === "note") continue;
    for (const u of f.urls) {
      const k = urlKey(u);
      const list = issuesByUrl.get(k) ?? [];
      if (!list.includes(f.id)) list.push(f.id);
      issuesByUrl.set(k, list);
    }
  }

  const pages: PublishedPage[] = audit.pages.map((p) => {
    const out: PublishedPage = {
      url: p.url,
      status: p.status,
      depth: p.depth,
      inSitemap: p.inSitemap,
      inlinks: p.inlinkCount,
      indexable: isIndexable(p),
      title: p.title ?? "",
      metaDescription: p.onPage?.metaDescription ?? "",
      h1: p.onPage?.h1s.join(" | ") ?? "",
      wordCount: p.onPage?.wordCount ?? null,
      timeMs: Math.round(p.timeMs),
      issues: issuesByUrl.get(urlKey(p.url)) ?? [],
    };
    if (p.error) out.error = p.error;
    if (p.redirectChain.length && p.finalUrl && p.finalUrl !== p.url) out.finalUrl = p.finalUrl;
    return out;
  });

  const sp = audit.speed;
  const speed =
    model.speed && sp
      ? {
          ...model.speed,
          rows: sp.sample.map((s): PublishedSpeedRow => {
            const r = sp.results.find((x) => x.url === s.url && x.strategy === "mobile");
            return {
              url: s.url,
              template: s.template,
              templatePages: s.templatePages,
              ...(s.reason ? { reason: s.reason } : {}),
              score: r?.score ?? null,
              scoreRating: rate("score", r?.score ?? null),
              lcp: formatMs(r?.lcp ?? null),
              lcpRating: rate("lcp", r?.lcp ?? null),
              cls: formatCls(r?.cls ?? null),
              tbt: formatMs(r?.tbt ?? null),
              error: r?.error ?? (r ? null : "Not tested"),
            };
          }),
        }
      : null;

  return {
    version: PUBLISHED_REPORT_VERSION,
    site: { host: hostOf(model.startUrl), startUrl: model.startUrl, origin: model.origin },
    audit: {
      startedAt: audit.startedAt,
      finishedAt: audit.finishedAt,
      durationText: model.durationText,
      pageLimit: model.pageLimit,
      pagesCrawled: model.pagesCrawled,
      checkExternal: options.checkExternal,
      partial: model.partial,
    },
    totals: {
      errors: model.totals.errors,
      warnings: model.totals.warnings,
      notices: model.totals.notices,
      brokenLinks: model.totals.brokenLinks,
      pagesCrawled: model.totals.pagesCrawled,
      okPages: model.totals.okPages,
    },
    topIssues: model.topIssues.map((t) => t.id),
    sections,
    speed,
    coverage: model.coverage,
    method: model.method,
    pages,
  };
}

/** gzip the snapshot for upload — keeps big audits well under the 4.5 MB request limit. */
export async function packPublishedReport(report: PublishedReport): Promise<Uint8Array> {
  const { gzipSync, strToU8 } = await import("fflate");
  return gzipSync(strToU8(JSON.stringify(report)), { level: 9 });
}
