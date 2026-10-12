/**
 * Phase 5b: which pages to speed-test, and the site-level score. Pure —
 * runs in the browser alongside the findings, reusable by the PDF later.
 *
 * Decisions (Ian, 2026-10-11): test a sample, not every page — 10% of
 * indexable pages, at least 5 and at most 50, spread across page types,
 * homepage always included, mobile only. Site score = median Lighthouse
 * performance score plus median LCP / CLS / TBT. Real-user (Chrome UX
 * Report) data is shown separately because it measures something else.
 */

import { isNoindex } from "./checks/on-page";
import { isSameSite, urlKey } from "./urls";
import { isImage } from "./checks/performance";
import type { AuditResult, SpeedResult, SpeedSampleEntry } from "./types";
import { SPEED_SAMPLE_MAX, SPEED_SAMPLE_MIN, SPEED_SAMPLE_SHARE } from "./types";

/** Pages worth testing: indexable, loading fine, one per final URL, no query strings. */
export function speedCandidates(audit: AuditResult): string[] {
  const { origin } = audit.discovery;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of audit.pages) {
    if (p.status !== 200 || !p.isHtml || !p.onPage || !isSameSite(p.finalUrl, origin)) continue;
    if (isNoindex(p.onPage)) continue;
    try {
      if (new URL(p.finalUrl).search) continue;
    } catch {
      continue;
    }
    const k = urlKey(p.finalUrl);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p.finalUrl);
  }
  return out;
}

/**
 * Page type from the URL shape: "/" for the homepage, "/*" for top-level
 * pages, otherwise the parent path — /blog/a-post → "/blog/*",
 * /blog/page/3 → "/blog/page/*", /blog/author/ian → "/blog/author/*".
 * Pages of the same type usually share a template, so they usually share
 * speed characteristics.
 */
export function templateOf(url: string): string {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return "/*";
  }
  if (segments.length === 0) return "/";
  if (segments.length === 1) return "/*";
  return `/${segments.slice(0, -1).join("/")}/*`;
}

export function sampleSize(candidates: number): number {
  if (candidates <= 0) return 0;
  const n = Math.round(candidates * SPEED_SAMPLE_SHARE);
  return Math.min(candidates, Math.max(SPEED_SAMPLE_MIN, Math.min(SPEED_SAMPLE_MAX, n)));
}

/** n items spread evenly through a list (first, last and between). */
function spread<T>(list: T[], n: number): T[] {
  if (n >= list.length) return list.slice();
  if (n === 1) return [list[0]];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out;
}

/** Thresholds for "likely slow" pages, from what the crawl already measured. */
const RISK = { heavyImage: 300 * 1024, slowMs: 2000, bigHtml: 200 * 1024, manyImages: 30 };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/**
 * Pages the crawl already suggests will be slow (Ian, 2026-10-12: make the
 * sample smarter rather than bigger). Scored by how far past each
 * threshold they are, so the worst come first.
 */
export function riskyPages(audit: AuditResult, candidates: string[]): { url: string; score: number; reason: string }[] {
  const imageBytes = new Map<string, number>();
  for (const r of audit.linkCheck?.results ?? []) {
    if (r.kind === "asset" && r.verdict === "ok" && r.contentLength && isImage(r)) imageBytes.set(r.url, r.contentLength);
  }
  const byFinal = new Map(audit.pages.map((p) => [urlKey(p.finalUrl), p] as const));
  // Images on lots of pages (logos, header/footer art) slow every page
  // equally — the type sample already measures them, so they don't single a
  // page out. Found on contentbloom.com: one 1.2 MB image on nearly every page.
  const uses = new Map<string, number>();
  for (const url of candidates) {
    for (const a of new Set(byFinal.get(urlKey(url))?.assetLinks ?? [])) uses.set(a, (uses.get(a) ?? 0) + 1);
  }
  const shared = Math.max(3, candidates.length * 0.2);
  const out: { url: string; score: number; reason: string }[] = [];
  for (const url of candidates) {
    const p = byFinal.get(urlKey(url));
    if (!p) continue;
    let score = 0;
    const reasons: string[] = [];
    const heavy = [...new Set(p.assetLinks ?? [])]
      .filter((a) => (uses.get(a) ?? 0) <= shared)
      .map((a) => imageBytes.get(a) ?? 0)
      .filter((b) => b > RISK.heavyImage);
    if (heavy.length) {
      const total = heavy.reduce((t, b) => t + b, 0);
      score += total / RISK.heavyImage;
      reasons.push(heavy.length === 1 ? `image of ${kb(total)}` : `${heavy.length} images over 300 KB (${kb(total)})`);
    }
    if (p.timeMs > RISK.slowMs) {
      score += p.timeMs / RISK.slowMs;
      reasons.push(`slow server response (${(p.timeMs / 1000).toFixed(1)} s)`);
    }
    if (p.sizeBytes > RISK.bigHtml) {
      score += p.sizeBytes / RISK.bigHtml;
      reasons.push(`large HTML (${kb(p.sizeBytes)})`);
    }
    const imgs = p.onPage?.imageCount ?? 0;
    if (imgs > RISK.manyImages) {
      score += imgs / RISK.manyImages;
      reasons.push(`${imgs} images`);
    }
    if (score > 0) out.push({ url, score, reason: reasons.join(", ") });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function pickSpeedSample(audit: AuditResult): { indexablePages: number; sample: SpeedSampleEntry[] } {
  const candidates = speedCandidates(audit);
  const n = sampleSize(candidates.length);
  if (n === 0) return { indexablePages: 0, sample: [] };

  const groups = new Map<string, string[]>();
  for (const url of candidates) {
    const t = templateOf(url);
    let g = groups.get(t);
    if (!g) groups.set(t, (g = []));
    g.push(url);
  }
  const sizes = new Map([...groups].map(([t, urls]) => [t, urls.length]));

  // Extra slots for pages the crawl flagged as likely slow: about a quarter
  // of the sample on top (at least 2), within the overall maximum.
  const risky = riskyPages(audit, candidates);
  const riskSlots = Math.min(risky.length, Math.max(2, Math.ceil(n / 4)), candidates.length - Math.min(n, candidates.length));
  const total = Math.min(SPEED_SAMPLE_MAX, n + riskSlots);
  const typeSlots = Math.max(1, total - riskSlots);

  const quota = new Map<string, number>();
  // Homepage always (it's the "/" group, size 1).
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === "/" ? -1 : b[0] === "/" ? 1 : b[1].length - a[1].length));
  let left = typeSlots;
  // One page from every type while slots last (biggest types first)…
  for (const [t] of ordered) {
    if (left === 0) break;
    quota.set(t, 1);
    left--;
  }
  // …then the rest in proportion to how many pages each type has.
  if (left > 0) {
    const shares = ordered.map(([t, urls]) => {
      const room = urls.length - (quota.get(t) ?? 0);
      const ideal = (urls.length / candidates.length) * typeSlots - (quota.get(t) ?? 0);
      return { t, room, ideal: Math.max(0, ideal) };
    });
    while (left > 0) {
      const best = shares.filter((s) => s.room > 0).sort((a, b) => b.ideal - a.ideal)[0];
      if (!best) break;
      quota.set(best.t, (quota.get(best.t) ?? 0) + 1);
      best.room--;
      best.ideal -= 1;
      left--;
    }
  }

  const sample: SpeedSampleEntry[] = [];
  const chosen = new Set<string>();
  for (const [t, urls] of ordered) {
    const k = quota.get(t) ?? 0;
    for (const url of spread(urls, k)) {
      sample.push({ url, template: t, templatePages: sizes.get(t) ?? 0 });
      chosen.add(url);
    }
  }
  const riskReason = new Map(risky.map((r) => [r.url, r.reason]));
  // A type-sampled page that's also risky says why it's interesting.
  for (const e of sample) if (riskReason.has(e.url)) e.reason = riskReason.get(e.url);
  let added = 0;
  for (const r of risky) {
    if (added >= total - sample.length) break;
    if (chosen.has(r.url)) continue;
    const t = templateOf(r.url);
    sample.push({ url: r.url, template: t, templatePages: sizes.get(t) ?? 0, reason: r.reason });
    chosen.add(r.url);
    added++;
  }
  return { indexablePages: candidates.length, sample };
}

// ------------------------------------------------------------ scoring

export type Rating = "good" | "ni" | "poor";

/** Google's thresholds (lab: Lighthouse; field: Core Web Vitals, p75). */
export const THRESHOLDS = {
  score: [90, 50] as const, // ≥90 good, <50 poor
  lcp: [2500, 4000] as const,
  cls: [0.1, 0.25] as const,
  tbt: [200, 600] as const,
  inp: [200, 500] as const,
  fcp: [1800, 3000] as const,
  ttfb: [800, 1800] as const,
};

export function rate(metric: keyof typeof THRESHOLDS, value: number | null | undefined): Rating | null {
  if (value === null || value === undefined) return null;
  const [good, poor] = THRESHOLDS[metric];
  if (metric === "score") return value >= good ? "good" : value < poor ? "poor" : "ni";
  return value <= good ? "good" : value > poor ? "poor" : "ni";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SiteSpeed {
  tested: number;
  failed: number;
  score: number | null;
  lcp: number | null;
  cls: number | null;
  tbt: number | null;
}

export function siteSpeed(results: SpeedResult[]): SiteSpeed {
  const ok = results.filter((r) => r.score !== null);
  const vals = (f: (r: SpeedResult) => number | null) => ok.map(f).filter((v): v is number => v !== null);
  const score = median(vals((r) => r.score));
  return {
    tested: ok.length,
    failed: results.length - ok.length,
    score: score === null ? null : Math.round(score),
    lcp: median(vals((r) => r.lcp)),
    cls: median(vals((r) => r.cls)),
    tbt: median(vals((r) => r.tbt)),
  };
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function formatCls(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toFixed(2);
}
