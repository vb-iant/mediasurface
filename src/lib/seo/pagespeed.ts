/**
 * Phase 5b: page speed via Google's PageSpeed Insights (Lighthouse lab
 * runs) and the Chrome UX Report (real-user field data). Server-only — the
 * API key (`PAGESPEED_API_KEY`, set in Vercel) never reaches the browser.
 *
 * Google fetches the page from its own servers, so nothing here connects
 * to the audited site; the SSRF guard isn't involved.
 */

import "server-only";
import type { FieldMetrics, SpeedOpportunity, SpeedResult, SpeedStrategy } from "./types";

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CRUX = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
/** A Lighthouse run usually takes 10–25s; the route's maxDuration is 60s. */
const PSI_TIMEOUT_MS = 50_000;

export class SpeedConfigError extends Error {}

function apiKey(): string {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) throw new SpeedConfigError("Page speed isn't set up: PAGESPEED_API_KEY is missing on the server.");
  return key;
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "Reduce unused JavaScript. [Learn more](https://…)." → text + link. */
function splitDescription(md: string): { text: string; link: string | null } {
  let link: string | null = null;
  const text = md
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_m, label: string, href: string) => {
      if (!link && /learn|more|about/i.test(label)) link = href;
      return /learn more/i.test(label) ? "" : label;
    })
    .replace(/`/g, "")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text, link };
}

function kib(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function itemDetail(item: Json): string | null {
  const parts: string[] = [];
  const wastedBytes = num(item.wastedBytes);
  const wastedMs = num(item.wastedMs);
  const total = num(item.totalBytes) ?? num(item.transferSize);
  if (wastedBytes) parts.push(`${kib(wastedBytes)} could be saved`);
  else if (total) parts.push(kib(total));
  if (wastedMs) parts.push(`${Math.round(wastedMs)} ms`);
  const blocking = num(item.blockingTime);
  if (blocking) parts.push(`${Math.round(blocking)} ms blocking`);
  return parts.length ? parts.join(" · ") : null;
}

function itemUrl(item: Json): string | null {
  if (typeof item.url === "string") return item.url;
  const node = item.node as Json | undefined;
  if (node && typeof node.snippet === "string") return node.snippet;
  if (typeof item.entity === "string") return item.entity;
  const ent = item.entity as Json | undefined;
  if (ent && typeof ent.text === "string") return ent.text;
  if (typeof item.source === "string") return item.source;
  return null;
}

/**
 * What to fix, from Lighthouse's "insights" and "diagnostics" groups: audits
 * that didn't pass (score under 0.9), biggest estimated saving first.
 */
function opportunities(lr: Json): SpeedOpportunity[] {
  const audits = (lr.audits ?? {}) as Record<string, Json>;
  const refs = (((lr.categories as Json)?.performance as Json)?.auditRefs ?? []) as { id: string; group?: string }[];
  const out: SpeedOpportunity[] = [];
  for (const ref of refs) {
    if (ref.group !== "insights" && ref.group !== "diagnostics") continue;
    const a = audits[ref.id];
    if (!a) continue;
    const mode = a.scoreDisplayMode;
    if (mode === "notApplicable" || mode === "informative" || mode === "manual" || mode === "error") continue;
    const score = num(a.score);
    if (score === null || score >= 0.9) continue;
    const ms = (a.metricSavings ?? {}) as Json;
    const { text, link } = splitDescription(String(a.description ?? ""));
    const details = (a.details ?? {}) as Json;
    const rawItems = Array.isArray(details.items) ? (details.items as Json[]) : [];
    const items = rawItems
      .map((it) => ({ url: itemUrl(it), detail: itemDetail(it) }))
      .filter((it): it is { url: string; detail: string | null } => !!it.url)
      .slice(0, 5);
    out.push({
      id: ref.id,
      title: String(a.title ?? ref.id),
      description: text,
      learnMore: link,
      displayValue: typeof a.displayValue === "string" ? a.displayValue : null,
      savings: {
        ...(num(ms.LCP) ? { lcp: num(ms.LCP)! } : {}),
        ...(num(ms.FCP) ? { fcp: num(ms.FCP)! } : {}),
        ...(num(ms.TBT) ? { tbt: num(ms.TBT)! } : {}),
        ...(num(ms.CLS) ? { cls: num(ms.CLS)! } : {}),
      },
      items,
    });
  }
  const weight = (o: SpeedOpportunity) => Math.max(o.savings.lcp ?? 0, o.savings.fcp ?? 0, o.savings.tbt ?? 0) + (o.savings.cls ?? 0) * 10_000;
  return out.sort((a, b) => weight(b) - weight(a));
}

/** PSI's per-URL loadingExperience (only when it's this URL's own data). */
function psiField(le: Json | undefined): FieldMetrics | null {
  if (!le || le.origin_fallback || !le.metrics) return null;
  const m = le.metrics as Record<string, Json>;
  const p = (k: string) => num(m[k]?.percentile);
  const good = (k: string) => {
    const d = m[k]?.distributions as { proportion?: number }[] | undefined;
    return d?.[0]?.proportion;
  };
  const cls = p("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  return {
    lcp: p("LARGEST_CONTENTFUL_PAINT_MS"),
    inp: p("INTERACTION_TO_NEXT_PAINT"),
    cls: cls === null ? null : cls / 100,
    fcp: p("FIRST_CONTENTFUL_PAINT_MS"),
    ttfb: p("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    goodShare: {
      lcp: good("LARGEST_CONTENTFUL_PAINT_MS"),
      inp: good("INTERACTION_TO_NEXT_PAINT"),
      cls: good("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    },
    collectionPeriod: null,
  };
}

export async function runPageSpeed(url: string, strategy: SpeedStrategy, diagnose: boolean): Promise<SpeedResult> {
  const qs = new URLSearchParams({ url, strategy, category: "performance", key: apiKey() });
  const base: SpeedResult = {
    url,
    strategy,
    score: null,
    lcp: null,
    cls: null,
    tbt: null,
    fcp: null,
    speedIndex: null,
    field: null,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
  let res: Response;
  try {
    res = await fetch(`${PSI}?${qs}`, { signal: AbortSignal.timeout(PSI_TIMEOUT_MS), cache: "no-store" });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ...base, error: timedOut ? "PageSpeed Insights took too long to respond." : "Couldn't reach PageSpeed Insights." };
  }
  const data = (await res.json().catch(() => null)) as Json | null;
  if (!res.ok || !data) {
    const msg = String(((data?.error as Json)?.message as string) ?? `HTTP ${res.status}`);
    // e.g. "Lighthouse returned error: FAILED_DOCUMENT_REQUEST…"
    return { ...base, error: res.status === 429 ? "PageSpeed Insights quota reached — try again shortly." : msg.slice(0, 300) };
  }
  const lr = data.lighthouseResult as Json | undefined;
  if (!lr) return { ...base, error: "PageSpeed Insights returned no Lighthouse result." };
  const audits = (lr.audits ?? {}) as Record<string, Json>;
  const metric = (id: string) => num(audits[id]?.numericValue);
  const score = num(((lr.categories as Json)?.performance as Json)?.score);
  const runtimeError = (lr.runtimeError as Json | undefined)?.message;
  return {
    ...base,
    score: score === null ? null : Math.round(score * 100),
    lcp: metric("largest-contentful-paint"),
    cls: metric("cumulative-layout-shift"),
    tbt: metric("total-blocking-time"),
    fcp: metric("first-contentful-paint"),
    speedIndex: metric("speed-index"),
    field: psiField(data.loadingExperience as Json | undefined),
    ...(diagnose ? { opportunities: opportunities(lr) } : {}),
    error: score === null ? String(runtimeError ?? "Lighthouse couldn't score this page.") : null,
  };
}

function cruxMetrics(record: Json): FieldMetrics {
  const m = (record.metrics ?? {}) as Record<string, Json>;
  const p75 = (k: string) => {
    const v = (m[k]?.percentiles as Json | undefined)?.p75;
    const n = typeof v === "string" ? Number(v) : v;
    return num(n);
  };
  const good = (k: string) => {
    const h = m[k]?.histogram as { density?: number }[] | undefined;
    return h?.[0]?.density;
  };
  const period = record.collectionPeriod as { firstDate?: Json; lastDate?: Json } | undefined;
  const d = (x?: Json) => (x ? `${x.year}-${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}` : "");
  return {
    lcp: p75("largest_contentful_paint"),
    inp: p75("interaction_to_next_paint"),
    cls: p75("cumulative_layout_shift"),
    fcp: p75("first_contentful_paint"),
    ttfb: p75("experimental_time_to_first_byte"),
    goodShare: {
      lcp: good("largest_contentful_paint"),
      inp: good("interaction_to_next_paint"),
      cls: good("cumulative_layout_shift"),
    },
    collectionPeriod: period ? `${d(period.firstDate)} to ${d(period.lastDate)}` : null,
  };
}

async function cruxQuery(origin: string, formFactor: "PHONE" | "DESKTOP"): Promise<FieldMetrics | null | "error"> {
  try {
    const res = await fetch(`${CRUX}?key=${encodeURIComponent(apiKey())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin, formFactor }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.status === 404) return null; // not enough Chrome traffic — normal for smaller sites
    if (!res.ok) return "error";
    const data = (await res.json()) as Json;
    return cruxMetrics(data.record as Json);
  } catch (err) {
    if (err instanceof SpeedConfigError) throw err;
    return "error";
  }
}

/**
 * Origin-level real-user data. CrUX keys on the exact origin, so if the
 * site's main address has no data the www/apex twin is tried too.
 */
export async function fieldData(origin: string): Promise<{
  found: boolean;
  origin: string;
  phone: FieldMetrics | null;
  desktop: FieldMetrics | null;
  error: string | null;
}> {
  const u = new URL(origin);
  const twin = new URL(origin);
  twin.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
  for (const o of [u.origin, twin.origin]) {
    const [phone, desktop] = await Promise.all([cruxQuery(o, "PHONE"), cruxQuery(o, "DESKTOP")]);
    if (phone === "error" && desktop === "error") {
      return { found: false, origin: o, phone: null, desktop: null, error: "Couldn't reach the Chrome UX Report." };
    }
    const p = phone === "error" ? null : phone;
    const d = desktop === "error" ? null : desktop;
    if (p || d) return { found: true, origin: o, phone: p, desktop: d, error: null };
  }
  return { found: false, origin: u.origin, phone: null, desktop: null, error: null };
}
