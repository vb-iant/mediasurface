/**
 * Turns an audit into the plain data the downloadable report renders:
 * `buildReportModel` for the PDF summary, `buildWorkbook` for the Excel
 * workbook. Pure — no React, no DOM — so both renderers stay thin and the
 * numbers can be checked without generating a file.
 *
 * Everything is derived from `AuditResult` + `computeFindings`, exactly as
 * the on-screen report is, and grouped with `STAGES` from stages.ts, so the
 * three views never disagree about what was found or where it belongs.
 *
 * The downloaded files are the only record of an audit (nothing is stored
 * server-side), so the workbook carries every URL; the PDF summarises and
 * points to it. Scope agreed with Ian 2026-10-12 (CTRL tm-1791738069391).
 */

import type { AuditResult, AuditPage, SpeedState } from "@/lib/seo/types";
import { computeFindings, isOnSite, summarise, type Finding, type LinkSource, type Severity } from "@/lib/seo/findings";
import { urlKey } from "@/lib/seo/urls";
import { fieldVerdict, formatCls, formatMs, rate, siteSpeed, type FieldVerdict, type Rating } from "@/lib/seo/speed";
import { STAGES, stageMetrics, stageStatus, type StageId, type StageMetric, type StageStatus } from "@/app/admin/(protected)/seo/stages";
import { guidanceFor, guideLink, plainText } from "@/lib/seo/guidance";
import type { ReportBrand } from "./brand";

export type AuditPhaseLike = "discovering" | "running" | "done" | "stopped" | "error";

export const SEVERITY_LABEL: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Notice" };
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** URLs shown per finding in the PDF; the workbook has all of them. */
export const PDF_EXAMPLE_URLS = 5;

// ------------------------------------------------------------ PDF model

export interface ReportExample {
  url: string;
  note?: string;
  /** First page linking to it, for link findings. */
  source?: LinkSource;
  sourceCount?: number;
}

export interface ReportFinding {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  caveat?: string;
  why?: string;
  how?: string;
  guideUrl: string | null;
  /** Affected URLs (0 for site-wide findings). */
  count: number;
  examples: ReportExample[];
}

export interface ReportSection {
  id: StageId;
  title: string;
  blurb: string;
  status: StageStatus;
  metrics: StageMetric[];
  findings: ReportFinding[];
  counts: Record<Severity, number>;
}

export interface ReportSpeed {
  status: SpeedState["status"];
  sampled: number;
  indexable: number;
  tested: number;
  score: number | null;
  scoreRating: Rating | null;
  lcp: string;
  lcpRating: Rating | null;
  cls: string;
  tbt: string;
  /** Real-visitor (Chrome UX Report) verdict — the same one the stage card shows. */
  field: FieldVerdict;
}

export interface ReportModel {
  brand: ReportBrand;
  host: string;
  startUrl: string;
  origin: string;
  generatedAt: Date;
  startedAt: Date;
  durationText: string;
  pageLimit: number;
  pagesCrawled: number;
  checkExternal: boolean;
  /** Why the audit is partial; empty when it ran to completion. */
  partial: string[];
  totals: ReturnType<typeof summarise>;
  topIssues: (ReportFinding & { stageTitle: string })[];
  sections: ReportSection[];
  speed: ReportSpeed | null;
  /** "About the audit" lines: coverage notes raised by this audit. */
  coverage: { title: string; line: string; caveat?: string }[];
  /** Standing method notes, always shown. */
  method: string[];
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function duration(startIso: string, endIso: string | null): string {
  const ms = (endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso);
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function sortFindings(a: Finding, b: Finding): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.urls.length - a.urls.length || a.title.localeCompare(b.title);
}

function toReportFinding(f: Finding): ReportFinding {
  const g = guidanceFor(f.id);
  return {
    id: f.id,
    title: f.title,
    severity: f.severity,
    description: f.description,
    caveat: f.caveat,
    why: g?.kind === "issue" ? plainText(g.why) : undefined,
    how: g?.kind === "issue" ? plainText(g.how) : undefined,
    guideUrl: guideLink(f.id),
    count: f.urls.length,
    examples: f.urls.slice(0, PDF_EXAMPLE_URLS).map((url) => {
      const sources = f.sources?.[url];
      return { url, note: f.notes?.[url], source: sources?.[0], sourceCount: sources?.length };
    }),
  };
}

/** Why an audit's results are incomplete, in client-readable sentences. */
export function partialReasons(audit: AuditResult, phase: AuditPhaseLike): string[] {
  const out: string[] = [];
  if (audit.status === "error" || phase === "error") {
    out.push(`The audit ended with an error${audit.error ? ` (${audit.error})` : ""}; results cover what was checked before it stopped.`);
  } else if (audit.status === "cancelled" || phase === "stopped") {
    out.push("The audit was stopped before it finished; results cover what was checked up to that point.");
  }
  if (audit.capReached) {
    out.push(
      `The crawl stopped at the ${audit.pageLimit.toLocaleString("en-GB")}-page limit. The site has more pages, so site-wide findings (orphan pages, sitemap gaps, click depth) are provisional.`
    );
  }
  if (audit.linkCheck.status === "cancelled") out.push("Link checks were stopped early, so link results are incomplete.");
  if (audit.speed && (audit.speed.status === "cancelled" || audit.speed.status === "error")) {
    out.push("Page speed tests were stopped before they finished.");
  }
  return out;
}

function speedModel(sp: SpeedState | undefined): ReportSpeed | null {
  if (!sp || sp.status === "skipped") return null;
  const site = siteSpeed(sp.results);
  return {
    status: sp.status,
    sampled: sp.sample.length,
    indexable: sp.indexablePages,
    tested: site.tested,
    score: site.score,
    scoreRating: rate("score", site.score),
    lcp: formatMs(site.lcp),
    lcpRating: rate("lcp", site.lcp),
    cls: formatCls(site.cls),
    tbt: formatMs(site.tbt),
    field: fieldVerdict(sp.field),
  };
}

const METHOD = [
  "Pages are found from the XML sitemap and by following links from the start page, breadth-first, up to the page limit chosen for the audit.",
  "robots.txt rules are honoured: disallowed pages are listed, not visited.",
  "Each page's HTML is read as served, without running JavaScript, so links that only appear after scripts run aren't found.",
  "\"Links we couldn't verify\" are sites that blocked or rate-limited an automated check; they usually work for people and aren't counted as broken.",
  "Page speed is measured with Google PageSpeed Insights (Lighthouse, mobile) on a sample of pages chosen across page types, plus pages the crawl flagged as likely slow. Scores vary between runs, so small differences are noise.",
  "Real-visitor figures come from Google's Chrome UX Report (28-day averages) and only exist for sites with enough Chrome traffic.",
];

export function buildReportModel(
  audit: AuditResult,
  phase: AuditPhaseLike,
  options: { checkExternal: boolean },
  brand: ReportBrand,
  findings: Finding[] = computeFindings(audit),
  now: Date = new Date()
): ReportModel {
  const issues = findings.filter((f) => guidanceFor(f.id)?.kind !== "note");
  const sections: ReportSection[] = STAGES.map((stage) => {
    const owned = issues.filter(stage.owns).sort(sortFindings);
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const f of owned) counts[f.severity] += Math.max(1, f.urls.length);
    return {
      id: stage.id,
      title: stage.title,
      blurb: stage.blurb,
      status: stageStatus(stage.id, audit, phase),
      metrics: stageMetrics(stage.id, audit, findings),
      findings: owned.map(toReportFinding),
      counts,
    };
  });

  const stageTitle = (f: Finding) => STAGES.find((s) => s.owns(f))?.title ?? "";
  const topIssues = issues
    .filter((f) => f.severity !== "info")
    .sort(sortFindings)
    .slice(0, 5)
    .map((f) => ({ ...toReportFinding(f), stageTitle: stageTitle(f) }));

  const coverage = findings
    .filter((f) => guidanceFor(f.id)?.kind === "note")
    .map((f) => {
      const g = guidanceFor(f.id);
      return { title: f.title, line: g?.kind === "note" ? plainText(g.line) : f.description, caveat: f.caveat };
    });

  return {
    brand,
    host: hostOf(audit.discovery.startUrl || audit.requestedUrl),
    startUrl: audit.discovery.startUrl || audit.requestedUrl,
    origin: audit.discovery.origin,
    generatedAt: now,
    startedAt: new Date(audit.startedAt),
    durationText: duration(audit.startedAt, audit.finishedAt),
    pageLimit: audit.pageLimit,
    pagesCrawled: audit.pages.length,
    checkExternal: options.checkExternal,
    partial: partialReasons(audit, phase),
    totals: summarise(audit, findings),
    topIssues,
    sections,
    speed: speedModel(audit.speed),
    coverage,
    method: METHOD,
  };
}

// ------------------------------------------------------------ workbook model

export type CellValue = string | number | null;

export interface SheetColumn {
  header: string;
  /** Approximate width in characters. */
  width: number;
  /** "url" and "text" are written as text; "number" as a number. */
  kind?: "text" | "number" | "url";
}

export interface SheetData {
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
}

export interface WorkbookData {
  sheets: SheetData[];
}

function isIndexable(p: AuditPage): boolean {
  const robots = `${p.onPage?.metaRobots ?? ""} ${p.onPage?.xRobotsTag ?? ""}`;
  return !/noindex/.test(robots);
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");
const kbOf = (bytes: number | null | undefined) => (bytes ? Math.round((bytes / 1024) * 10) / 10 : null);
const ratingLabel = (r: Rating | null) => (r === "good" ? "Good" : r === "ni" ? "Needs improvement" : r === "poor" ? "Poor" : "");

export function buildWorkbook(
  audit: AuditResult,
  phase: AuditPhaseLike,
  options: { checkExternal: boolean },
  brand: ReportBrand,
  findings: Finding[] = computeFindings(audit),
  now: Date = new Date()
): WorkbookData {
  const model = buildReportModel(audit, phase, options, brand, findings, now);
  const stageOf = (f: Finding) => STAGES.find((s) => s.owns(f))?.title ?? "";

  // About ------------------------------------------------------------
  const about: CellValue[][] = [
    ["Site", model.startUrl],
    ["Audit run", model.startedAt.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })],
    ["Prepared by", `${brand.name} (${brand.websiteLabel})`],
    ["Status", model.partial.length ? "Partial — see notes below" : "Complete"],
    ...model.partial.map((r): CellValue[] => ["Partial audit", r]),
    ["Pages crawled", model.pagesCrawled],
    ["Page limit", model.pageLimit],
    ["Took", model.durationText],
    ["External links checked", yesNo(options.checkExternal)],
    ["Errors", model.totals.errors],
    ["Warnings", model.totals.warnings],
    ["Notices", model.totals.notices],
    ["Broken links", model.totals.brokenLinks],
  ];
  if (model.speed) {
    about.push(
      ["Site speed score (mobile, median of sample)", model.speed.score],
      ["Median LCP (mobile)", model.speed.lcp],
      ["Pages speed-tested", `${model.speed.tested} of ${model.speed.sampled} sampled (from ${model.speed.indexable} indexable pages)`]
    );
    about.push(["Real visitors (Chrome UX Report)", `${model.speed.field.label} — ${model.speed.field.detail}`]);
  }
  for (const c of model.coverage) about.push([c.title, c.line]);
  about.push(["How to read this workbook", "Findings: one row per issue per affected URL (and per linking page for link issues). Pages: every page crawled. Links: every link, file and image checked. Speed: the sampled pages."]);
  about.push(["Fix guidance", "Each finding's Guide link explains why it matters and how to fix it."]);
  for (const m of model.method) about.push(["Method", m]);

  // Findings ---------------------------------------------------------
  const findingRows: CellValue[][] = [];
  for (const f of [...findings].sort(sortFindings)) {
    const isNote = guidanceFor(f.id)?.kind === "note";
    const base = [SEVERITY_LABEL[f.severity], isNote ? "About the audit" : stageOf(f), f.title];
    const guide = guideLink(f.id);
    if (f.urls.length === 0) {
      findingRows.push([...base, "", f.caveat ?? f.description, "", "", guide]);
      continue;
    }
    for (const url of f.urls) {
      const note = f.notes?.[url] ?? "";
      const sources = f.sources?.[url] ?? [];
      if (sources.length === 0) findingRows.push([...base, url, note, "", "", guide]);
      for (const s of sources) findingRows.push([...base, url, note, s.page, s.text, guide]);
    }
  }

  // Pages ------------------------------------------------------------
  const issuesByUrl = new Map<string, string[]>();
  for (const f of findings) {
    for (const u of f.urls) {
      const k = urlKey(u);
      const list = issuesByUrl.get(k) ?? [];
      if (!list.includes(f.title)) list.push(f.title);
      issuesByUrl.set(k, list);
    }
  }
  const pageRows: CellValue[][] = audit.pages.map((p) => {
    const issues = issuesByUrl.get(urlKey(p.url)) ?? [];
    const op = p.onPage;
    return [
      p.url,
      p.status || (p.error ?? "No response"),
      p.redirectChain.length ? p.finalUrl : "",
      p.depth,
      yesNo(p.inSitemap),
      p.inlinkCount,
      op ? yesNo(isIndexable(p)) : "",
      p.title ?? "",
      op?.metaDescription ?? "",
      op?.h1s.join(" | ") ?? "",
      op?.canonical ?? "",
      op?.wordCount ?? null,
      Math.round(p.timeMs),
      kbOf(p.sizeBytes),
      issues.length,
      issues.join("; "),
    ];
  });

  // Links ------------------------------------------------------------
  const linkedFrom = new Map<string, string[]>();
  for (const p of audit.pages) {
    if (!isOnSite(p, audit.discovery.origin)) continue;
    for (const target of [...p.externalLinks, ...p.assetLinks]) {
      const list = linkedFrom.get(target) ?? [];
      if (list.length < 50) list.push(p.finalUrl || p.url);
      linkedFrom.set(target, list);
    }
  }
  const verdictLabel = { ok: "OK", broken: "Broken", unverified: "Couldn't verify" } as const;
  const linkRows: CellValue[][] = audit.linkCheck.results.map((r) => {
    const from = linkedFrom.get(r.url) ?? [];
    return [
      r.url,
      r.kind === "external" ? "External link" : "File or image on this site",
      verdictLabel[r.verdict],
      r.status || null,
      r.reason,
      r.finalUrl && r.finalUrl !== r.url ? r.finalUrl : "",
      kbOf(r.contentLength),
      from.length,
      from[0] ?? "",
    ];
  });

  // Speed ------------------------------------------------------------
  const sp = audit.speed;
  const speedRows: CellValue[][] = (sp?.sample ?? []).map((s) => {
    const r = sp?.results.find((x) => x.url === s.url && x.strategy === "mobile");
    return [
      s.url,
      s.template,
      s.reason ?? "",
      r?.score ?? null,
      ratingLabel(rate("score", r?.score)),
      r?.lcp != null ? Math.round(r.lcp) / 1000 : null,
      r?.cls != null ? Math.round(r.cls * 1000) / 1000 : null,
      r?.tbt != null ? Math.round(r.tbt) : null,
      r?.fcp != null ? Math.round(r.fcp) / 1000 : null,
      r?.error ?? (r ? "" : "Not tested"),
    ];
  });

  const sheets: SheetData[] = [
    { name: "About", columns: [{ header: "Item", width: 34 }, { header: "Detail", width: 110 }], rows: about },
    {
      name: "Findings",
      columns: [
        { header: "Severity", width: 10 },
        { header: "Stage", width: 16 },
        { header: "Finding", width: 42 },
        { header: "URL", width: 60, kind: "url" },
        { header: "Detail", width: 40 },
        { header: "Linked from", width: 60, kind: "url" },
        { header: "Link text", width: 30 },
        { header: "Guide", width: 50, kind: "url" },
      ],
      rows: findingRows,
    },
    {
      name: "Pages",
      columns: [
        { header: "URL", width: 60, kind: "url" },
        { header: "Status", width: 8 },
        { header: "Redirects to", width: 50, kind: "url" },
        { header: "Click depth", width: 11, kind: "number" },
        { header: "In sitemap", width: 10 },
        { header: "Internal links in", width: 15, kind: "number" },
        { header: "Indexable", width: 10 },
        { header: "Title", width: 50 },
        { header: "Meta description", width: 60 },
        { header: "H1", width: 40 },
        { header: "Canonical", width: 50, kind: "url" },
        { header: "Words", width: 8, kind: "number" },
        { header: "Response (ms)", width: 13, kind: "number" },
        { header: "HTML (KB)", width: 10, kind: "number" },
        { header: "Issues", width: 8, kind: "number" },
        { header: "Issue list", width: 80 },
      ],
      rows: pageRows,
    },
    {
      name: "Links",
      columns: [
        { header: "Link", width: 60, kind: "url" },
        { header: "Type", width: 24 },
        { header: "Result", width: 15 },
        { header: "HTTP status", width: 11, kind: "number" },
        { header: "Reason", width: 30 },
        { header: "Ends up at", width: 50, kind: "url" },
        { header: "Size (KB)", width: 10, kind: "number" },
        { header: "Pages linking", width: 13, kind: "number" },
        { header: "First page linking", width: 60, kind: "url" },
      ],
      rows: linkRows,
    },
  ];
  if (sp && sp.status !== "skipped") {
    sheets.push({
      name: "Speed",
      columns: [
        { header: "Page", width: 60, kind: "url" },
        { header: "Page type", width: 18 },
        { header: "Why sampled", width: 40 },
        { header: "Score (mobile)", width: 14, kind: "number" },
        { header: "Rating", width: 18 },
        { header: "LCP (s)", width: 9, kind: "number" },
        { header: "CLS", width: 8, kind: "number" },
        { header: "TBT (ms)", width: 10, kind: "number" },
        { header: "FCP (s)", width: 9, kind: "number" },
        { header: "Note", width: 30 },
      ],
      rows: speedRows,
    });
  }
  return { sheets };
}

/** `<host>-seo-audit-<YYYY-MM-DD>` — shared stem for the zip, PDF and workbook. */
export function reportFileStem(audit: AuditResult): string {
  const host = hostOf(audit.discovery.startUrl || audit.requestedUrl).replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-");
  const d = new Date(audit.startedAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${host}-seo-audit-${date}`;
}
