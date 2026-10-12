/**
 * The audit's stages, as shown on the overview screen (Ian, 2026-10-11:
 * "the first screen shows each stage, with some high-level metrics and the
 * option to click in and explore more").
 *
 * Each stage owns a slice of the findings, works out its own status from
 * the running audit, and offers two or three headline numbers. Pure — no
 * React — so it's easy to test and the later PDF can reuse it.
 */

import type { Finding } from "@/lib/seo/findings";
import type { AuditResult } from "@/lib/seo/types";
import { summarise } from "@/lib/seo/findings";
import { AI_BOTS } from "@/lib/seo/ai-bots";
import { isImage } from "@/lib/seo/checks/performance";
import { fieldVerdict, formatMs, rate, siteSpeed, type Rating } from "@/lib/seo/speed";

export type StageId = "discovery" | "crawl" | "links" | "onpage" | "structure" | "schema" | "performance" | "speed";
export type StageStatus = "waiting" | "running" | "done" | "skipped" | "stopped";

export interface StageMetric {
  label: string;
  value: string;
  tone?: "bad" | "warn" | "good";
}

export interface StageDef {
  id: StageId;
  title: string;
  blurb: string;
  /** Which findings this stage shows. */
  owns: (f: Finding) => boolean;
}

const HOST_FINDINGS = /^(hosts-|hsts-)/;

export const STAGES: StageDef[] = [
  {
    id: "discovery",
    title: "Discovery",
    blurb: "robots.txt, sitemap, site addresses and AI crawler access",
    owns: (f) => f.category === "sitemap" || f.category === "ai" || HOST_FINDINGS.test(f.id),
  },
  {
    id: "crawl",
    title: "Crawl & status",
    blurb: "Every page found, status codes and redirects",
    owns: (f) => f.category === "status" && !HOST_FINDINGS.test(f.id),
  },
  {
    id: "links",
    title: "Links",
    blurb: "Broken links, files, images and external links",
    owns: (f) => f.category === "links",
  },
  {
    id: "onpage",
    title: "On-page SEO",
    blurb: "Titles, descriptions, headings, canonicals, mobile, content",
    owns: (f) => f.category === "onpage",
  },
  {
    id: "structure",
    title: "Site structure",
    blurb: "Click depth and internal linking",
    owns: (f) => f.category === "structure",
  },
  {
    id: "schema",
    title: "Structured data",
    blurb: "JSON-LD and other schema markup",
    owns: (f) => f.category === "schema",
  },
  {
    id: "performance",
    title: "Speed & weight",
    blurb: "Image sizes, compression and caching",
    owns: (f) => f.category === "performance",
  },
  {
    id: "speed",
    title: "Page speed",
    blurb: "Lighthouse on a sample of pages, plus real-visitor data",
    owns: (f) => f.category === "speed",
  },
];

export function stageById(id: string): StageDef | undefined {
  return STAGES.find((s) => s.id === id);
}

/** Where a stage is, given the audit's progress. */
export function stageStatus(
  stage: StageId,
  audit: AuditResult | null,
  phase: "discovering" | "running" | "done" | "stopped" | "error"
): StageStatus {
  if (!audit) return stage === "discovery" && phase === "discovering" ? "running" : phase === "error" ? "skipped" : "waiting";
  const crawling = audit.stage === "crawling" || audit.stage === "rechecking";
  const stopped = phase === "stopped" || audit.status === "cancelled" || audit.status === "error";
  switch (stage) {
    case "discovery":
      return "done";
    case "speed": {
      const sp = audit.speed;
      if (!sp) return phase === "running" ? "waiting" : stopped ? "stopped" : "skipped";
      if (sp.status === "running") return "running";
      if (sp.status === "complete") return "done";
      if (sp.status === "pending") return "waiting";
      if (sp.status === "skipped") return "skipped";
      return "stopped";
    }
    case "links": {
      const lc = audit.linkCheck.status;
      if (lc === "complete") return "done";
      if (lc === "skipped") return stopped ? "stopped" : "skipped";
      if (lc === "cancelled" || (stopped && lc !== "running")) return "stopped";
      return phase === "running" ? "running" : "stopped";
    }
    default:
      // Crawl-derived stages fill in live as pages arrive.
      if (phase === "running" && crawling) return "running";
      if (stopped) return "stopped";
      // Performance depends on image sizes from the post-crawl file checks.
      if (stage === "performance" && phase === "running" && audit.stage === "checking-links") return "running";
      return "done";
  }
}

const n = (x: number) => x.toLocaleString("en-GB");
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/** Two or three headline numbers per stage. */
export function stageMetrics(stage: StageId, audit: AuditResult, findings: Finding[]): StageMetric[] {
  const ids = new Map(findings.map((f) => [f.id, f]));
  const count = (id: string) => ids.get(id)?.urls.length ?? 0;
  const d = audit.discovery;
  switch (stage) {
    case "discovery": {
      const blockedSearch = d.ai?.bots.filter((b) => {
        const bot = AI_BOTS.find((x) => x.token === b.token);
        return bot && bot.group !== "training" && (!b.allowedRoot || !b.allowedStart);
      }).length ?? 0;
      const addressesOk = d.hosts?.filter((h) => !h.error || /domain not found/i.test(h.error)).length ?? 0;
      const out: StageMetric[] = [
        { label: "Sitemap URLs", value: d.sitemap.found ? n(d.sitemap.urls.length) : "None", tone: d.sitemap.found ? undefined : "warn" },
        { label: "robots.txt", value: d.robots.found ? "Found" : "None", tone: d.robots.found ? undefined : "warn" },
        {
          label: "AI search bots",
          value: blockedSearch ? `${blockedSearch} blocked` : "Allowed",
          tone: blockedSearch ? "warn" : "good",
        },
        ...(d.hosts?.length ? [{ label: "Site addresses", value: `${addressesOk} of ${d.hosts.length} OK` }] : []),
      ];
      return out.slice(0, 3);
    }
    case "crawl": {
      const s = summarise(audit, findings);
      return [
        { label: "Pages crawled", value: n(s.pagesCrawled) },
        { label: "Loading fine", value: n(s.okPages), tone: "good" },
        { label: "Redirected", value: n(s.redirectedPages), tone: s.redirectedPages ? "warn" : undefined },
      ];
    }
    case "links": {
      const lc = audit.linkCheck;
      const broken = count("broken-links");
      const ext = count("broken-external");
      return [
        { label: "Broken links", value: n(broken), tone: broken ? "bad" : "good" },
        { label: "Broken external", value: lc.externalSkipped ? "Not checked" : n(ext), tone: ext ? "bad" : undefined },
        { label: "Checked", value: `${n(lc.results.length)}${lc.total > lc.results.length ? ` of ${n(lc.total)}` : ""}` },
      ];
    }
    case "onpage": {
      const titles = count("title-missing") + count("title-duplicate") + count("title-long");
      const desc = count("description-missing") + count("description-duplicate") + count("description-long");
      return [
        { label: "Titles", value: n(titles), tone: titles ? "warn" : "good" },
        { label: "Descriptions", value: n(desc), tone: desc ? "warn" : "good" },
        { label: "Canonicals", value: n(count("canonical-off-site") + count("canonical-broken")), tone: count("canonical-off-site") ? "bad" : undefined },
      ];
    }
    case "structure": {
      const deepest = audit.pages.reduce((m, p) => Math.max(m, p.depth ?? 0), 0);
      return [
        { label: "Deepest page", value: `${deepest} click${deepest === 1 ? "" : "s"}` },
        { label: "Over 3 clicks", value: n(count("deep-pages")), tone: count("deep-pages") ? "warn" : "good" },
        { label: "Orphans", value: n(count("orphans")), tone: count("orphans") ? "warn" : undefined },
      ];
    }
    case "schema": {
      const withData = audit.pages.filter(
        (p) => (p.onPage?.structuredData.items.length ?? 0) > 0 || (p.onPage?.structuredData.microdataTypes.length ?? 0) > 0
      ).length;
      const types = new Set(audit.pages.flatMap((p) => p.onPage?.structuredData.items.flatMap((i) => i.types) ?? []));
      return [
        { label: "With markup", value: n(withData), tone: withData ? undefined : "warn" },
        { label: "Types used", value: types.size ? n(types.size) : "None" },
        { label: "Invalid", value: n(count("schema-invalid")), tone: count("schema-invalid") ? "bad" : undefined },
      ];
    }
    case "performance": {
      const imgs = audit.linkCheck.results.filter((r) => r.kind === "asset" && r.verdict === "ok" && r.contentLength && isImage(r));
      const biggest = imgs.reduce((m, r) => Math.max(m, r.contentLength ?? 0), 0);
      return [
        { label: "Over 300 KB", value: n(count("images-heavy")), tone: count("images-heavy") ? "warn" : "good" },
        { label: "Largest image", value: biggest ? kb(biggest) : "—" },
        { label: "Uncompressed", value: n(count("html-uncompressed")), tone: count("html-uncompressed") ? "warn" : "good" },
      ];
    }
    case "speed": {
      const sp = audit.speed;
      const tone = (r: Rating | null): StageMetric["tone"] => (r === "good" ? "good" : r === "ni" ? "warn" : r === "poor" ? "bad" : undefined);
      if (!sp || sp.status === "skipped") {
        return [
          { label: "Site score", value: "—" },
          { label: "Median LCP", value: "—" },
          { label: "Real visitors", value: "—" },
        ];
      }
      const site = siteSpeed(sp.results);
      // Shared with the PDF and workbook (fieldVerdict) so they can't disagree.
      const fv = fieldVerdict(sp.field);
      return [
        { label: "Site score", value: site.score === null ? "—" : String(site.score), tone: tone(rate("score", site.score)) },
        { label: "Median LCP", value: formatMs(site.lcp), tone: tone(rate("lcp", site.lcp)) },
        { label: "Real visitors", value: !sp.field ? "…" : fv.label, tone: tone(fv.rating) },
      ];
    }
  }
}
