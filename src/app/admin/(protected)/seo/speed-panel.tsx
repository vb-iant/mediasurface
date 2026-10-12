"use client";

/**
 * Phase 5b: the Page speed stage — site score from a sample of pages
 * (Lighthouse, mobile), real-visitor data (Chrome UX Report) shown
 * separately, and a per-page speed diagnosis (mobile + desktop, with what
 * to fix).
 */

import { Fragment, useState } from "react";
import { fieldVerdict, formatCls, formatMs, rate, siteSpeed, type Rating } from "@/lib/seo/speed";
import type { AuditResult, FieldMetrics, SpeedDiagnosis, SpeedOpportunity, SpeedResult } from "@/lib/seo/types";
import { activeAudit, runDiagnosis, startSpeed, type AuditRecord } from "./audit-store";
import { card, displayPath, muted } from "./report";

const RATING_TEXT: Record<Rating, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  ni: "text-amber-600 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-400",
};
const RATING_RING: Record<Rating, string> = {
  good: "border-emerald-500",
  ni: "border-amber-500",
  poor: "border-red-500",
};

function Rated({ r, children, className = "" }: { r: Rating | null; children: React.ReactNode; className?: string }) {
  return <span className={`${r ? RATING_TEXT[r] : "text-zinc-900 dark:text-zinc-50"} ${className}`}>{children}</span>;
}

const btn =
  "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function SpeedPanel({ record, audit }: { record: AuditRecord; audit: AuditResult }) {
  const sp = audit.speed;
  const [startError, setStartError] = useState<string | null>(null);
  const canRun = audit.status === "complete" && !activeAudit();
  const start = () => {
    setStartError(null);
    try {
      startSpeed(record.id);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!sp || sp.status === "skipped" || sp.status === "pending") {
    return (
      <div className={`mt-6 px-4 py-5 text-sm ${card}`}>
        <p className="text-zinc-900 dark:text-zinc-50">
          {audit.status !== "complete"
            ? "Page speed runs once the crawl has finished."
            : sp?.status === "skipped"
              ? "Page speed wasn't tested for this audit."
              : "Page speed hasn't been tested yet."}
        </p>
        <p className={`mt-1 ${muted}`}>
          Tests about 10% of the site&apos;s pages (5–50, spread across page types, homepage included) with Google&apos;s
          Lighthouse on mobile, and looks up real-visitor data. Takes a few minutes.
        </p>
        {audit.status === "complete" && (
          <button type="button" onClick={start} disabled={!canRun} className={`mt-3 ${btn}`}>
            Test page speed
          </button>
        )}
        {startError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{startError}</p>}
      </div>
    );
  }

  const site = siteSpeed(sp.results);
  const scoreRating = rate("score", site.score);
  const types = new Set(sp.sample.map((s) => s.template)).size;
  const flagged = sp.sample.filter((s) => s.reason).length;
  const running = sp.status === "running";

  return (
    <div className="mt-6 space-y-6">
      {sp.status === "error" && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Page speed stopped: {sp.error}
        </p>
      )}
      {(sp.status === "cancelled" || sp.status === "error" || sp.status === "complete") && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-xs ${muted}`}>
            {sp.status === "cancelled" && "The tests were stopped early — the score covers the pages tested so far. "}
            Lighthouse results vary a few points between runs; treat small differences as noise.
          </p>
          <button type="button" onClick={start} disabled={!canRun} className={btn}>
            Re-test page speed
          </button>
        </div>
      )}
      {startError && <p className="text-xs text-red-600 dark:text-red-400">{startError}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`p-4 ${card}`}>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Site speed score · mobile</h2>
          <div className="mt-3 flex items-center gap-5">
            <div
              className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-[6px] ${
                scoreRating ? RATING_RING[scoreRating] : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <Rated r={scoreRating} className="text-2xl font-semibold tabular-nums">
                {site.score ?? "—"}
              </Rated>
            </div>
            <dl className="grid flex-1 grid-cols-3 gap-2 text-sm">
              <Metric label="LCP" value={formatMs(site.lcp)} r={rate("lcp", site.lcp)} hint="Largest Contentful Paint: when the main content appears" />
              <Metric label="CLS" value={formatCls(site.cls)} r={rate("cls", site.cls)} hint="Cumulative Layout Shift: how much the page jumps around" />
              <Metric label="TBT" value={formatMs(site.tbt)} r={rate("tbt", site.tbt)} hint="Total Blocking Time: how long the page is too busy to respond" />
            </dl>
          </div>
          <p className={`mt-3 text-xs leading-relaxed ${muted}`}>
            Median of {site.tested} page{site.tested === 1 ? "" : "s"} tested
            {running && ` so far (of ${sp.sample.length})`}
            {!running && sp.sample.length > 0 && ` — ${sp.sample.length} of ${sp.indexablePages.toLocaleString("en-GB")} indexable pages, across ${types} page type${types === 1 ? "" : "s"}${
              flagged ? `, including ${flagged} the crawl flagged as likely slow` : ""
            }`}
            {site.failed > 0 && `; ${site.failed} couldn't be tested`}. Lab test: Lighthouse simulating a mid-range phone on a
            slow 4G connection, so it reads slower than most real visits.
          </p>
        </section>

        <FieldPanel field={sp.field} running={running} />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Pages tested</h2>
        <p className={`mt-1 text-xs ${muted}`}>
          Run a speed diagnosis on a page for mobile and desktop results and what to fix. Pages of the same type usually
          share the same fixes.
        </p>
        <SampleTable record={record} audit={audit} />
      </section>
    </div>
  );
}

function Metric({ label, value, r, hint }: { label: string; value: string; r: Rating | null; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className={`text-xs ${muted}`}>{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">
        <Rated r={r}>{value}</Rated>
      </dd>
    </div>
  );
}

function pct(v: number | undefined): string {
  return v === undefined ? "" : `${Math.round(v * 100)}% good`;
}

function FieldRow({ label, f }: { label: string; f: FieldMetrics }) {
  return (
    <div className="border-t border-zinc-100 pt-3 first:border-0 first:pt-0 dark:border-zinc-900">
      <div className={`text-xs ${muted}`}>{label}</div>
      <dl className="mt-1 grid grid-cols-3 gap-2 text-sm">
        {(
          [
            ["LCP", formatMs(f.lcp), rate("lcp", f.lcp), f.goodShare.lcp],
            ["INP", formatMs(f.inp), rate("inp", f.inp), f.goodShare.inp],
            ["CLS", formatCls(f.cls), rate("cls", f.cls), f.goodShare.cls],
          ] as const
        ).map(([l, v, r, g]) => (
          <div key={l} className="min-w-0">
            <dt className={`text-xs ${muted}`}>{l}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">
              <Rated r={r}>{v}</Rated>
              {g !== undefined && <span className={`block text-xs font-normal ${muted}`}>{pct(g)}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FieldPanel({ field, running }: { field: NonNullable<AuditResult["speed"]>["field"]; running: boolean }) {
  return (
    <section className={`p-4 ${card}`}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Real visitors · Chrome UX Report</h2>
      {!field ? (
        <p className={`mt-3 text-sm ${muted}`}>{running ? "Looking up…" : "Not looked up."}</p>
      ) : field.error ? (
        <p className={`mt-3 text-sm ${muted}`}>{field.error}</p>
      ) : !field.found ? (
        <>
          <p className="mt-3 text-sm text-zinc-900 dark:text-zinc-50">Not enough real-visitor data for this site.</p>
          <p className={`mt-1 text-xs leading-relaxed ${muted}`}>
            Google only publishes it for sites with enough Chrome traffic — normal for smaller sites. The lab score is the
            guide here.
          </p>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          {/* Same verdict as the stage card, PDF and workbook (fieldVerdict). */}
          <p className="text-sm text-zinc-900 dark:text-zinc-50">
            <span className="font-medium">{fieldVerdict(field).label}.</span>{" "}
            <span className={muted}>{fieldVerdict(field).detail}</span>
          </p>
          {field.phone && <FieldRow label="Phones" f={field.phone} />}
          {field.desktop && <FieldRow label="Desktop" f={field.desktop} />}
          <p className={`text-xs leading-relaxed ${muted}`}>
            75th percentile of real Chrome visits over 28 days
            {(field.phone ?? field.desktop)?.collectionPeriod && ` (${(field.phone ?? field.desktop)!.collectionPeriod})`} — the
            Core Web Vitals Google uses for ranking. Good is LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
          </p>
        </div>
      )}
    </section>
  );
}

function SampleTable({ record, audit }: { record: AuditRecord; audit: AuditResult }) {
  const sp = audit.speed!;
  const [open, setOpen] = useState<string | null>(null);
  const byUrl = new Map(sp.results.map((r) => [r.url, r]));
  const origin = audit.discovery.origin;
  const running = sp.status === "running";

  return (
    <div className={`mt-3 overflow-x-auto ${card}`}>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className={`border-b border-zinc-100 text-left text-xs dark:border-zinc-900 ${muted}`}>
            <th className="px-4 py-2 font-medium">Page</th>
            <th className="px-2 py-2 font-medium">Score</th>
            <th className="px-2 py-2 font-medium">LCP</th>
            <th className="px-2 py-2 font-medium">CLS</th>
            <th className="px-2 py-2 font-medium">TBT</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {sp.sample.map((s) => {
            const r = byUrl.get(s.url);
            const d = sp.diagnoses[s.url];
            const isOpen = open === s.url;
            return (
              <Fragment key={s.url}>
                <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="max-w-0 px-4 py-2">
                    <a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-zinc-900 hover:underline dark:text-zinc-50">
                      {displayPath(s.url, origin)}
                    </a>
                    <span className={`block truncate text-xs ${muted}`}>
                      {s.template === "/" ? "Homepage" : `${s.template} · ${s.templatePages} page${s.templatePages === 1 ? "" : "s"} of this type`}
                    </span>
                    {s.reason && (
                      <span className="block truncate text-xs text-amber-600 dark:text-amber-400" title={s.reason}>
                        Flagged by the crawl: {s.reason}
                      </span>
                    )}
                  </td>
                  {r ? (
                    r.score === null ? (
                      <td colSpan={4} className={`px-2 py-2 text-xs ${muted}`} title={r.error ?? undefined}>
                        Couldn&apos;t test
                      </td>
                    ) : (
                      <>
                        <td className="px-2 py-2 font-semibold tabular-nums">
                          <Rated r={rate("score", r.score)}>{r.score}</Rated>
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          <Rated r={rate("lcp", r.lcp)}>{formatMs(r.lcp)}</Rated>
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          <Rated r={rate("cls", r.cls)}>{formatCls(r.cls)}</Rated>
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          <Rated r={rate("tbt", r.tbt)}>{formatMs(r.tbt)}</Rated>
                        </td>
                      </>
                    )
                  ) : (
                    <td colSpan={4} className={`px-2 py-2 text-xs ${muted}`}>
                      {running ? "Waiting…" : "Not tested"}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {d ? (
                      <button type="button" onClick={() => setOpen(isOpen ? null : s.url)} className="text-xs font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                        {d.status === "running" ? "Diagnosing…" : isOpen ? "Hide diagnosis" : "View diagnosis"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          runDiagnosis(record.id, s.url);
                          setOpen(s.url);
                        }}
                        className="text-xs font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                      >
                        Run speed diagnosis
                      </button>
                    )}
                  </td>
                </tr>
                {isOpen && d && (
                  <tr className="border-b border-zinc-100 bg-zinc-50/60 last:border-0 dark:border-zinc-900 dark:bg-zinc-900/30">
                    <td colSpan={6} className="px-4 py-4">
                      <Diagnosis d={d} onRetry={() => runDiagnosis(record.id, s.url)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Diagnosis({ d, onRetry }: { d: SpeedDiagnosis; onRetry: () => void }) {
  const [view, setView] = useState<"mobile" | "desktop">("mobile");
  if (d.status === "running") {
    return <p className={`text-sm ${muted}`}>Running Lighthouse for mobile and desktop — usually 15–30 seconds…</p>;
  }
  if (d.status === "error") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        {d.error}{" "}
        <button type="button" onClick={onRetry} className="underline">
          Try again
        </button>
      </p>
    );
  }
  const result = view === "mobile" ? d.mobile : d.desktop;
  return (
    <div className="max-w-full">
      <div className="flex flex-wrap items-center gap-2">
        {(["mobile", "desktop"] as const).map((v) => {
          const r = v === "mobile" ? d.mobile : d.desktop;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === v ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : `${muted} hover:bg-zinc-100 dark:hover:bg-zinc-900`
              }`}
            >
              {v === "mobile" ? "Mobile" : "Desktop"} {r?.score ?? "—"}
            </button>
          );
        })}
        <button type="button" onClick={onRetry} className={`ml-auto text-xs hover:underline ${muted}`}>
          Run again
        </button>
      </div>
      {result && <DiagnosisResult r={result} />}
    </div>
  );
}

function DiagnosisResult({ r }: { r: SpeedResult }) {
  if (r.score === null) return <p className={`mt-3 text-sm ${muted}`}>{r.error ?? "Couldn't test this page."}</p>;
  const ops = r.opportunities ?? [];
  return (
    <div className="mt-3">
      <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
        <Metric label="Score" value={String(r.score)} r={rate("score", r.score)} />
        <Metric label="LCP" value={formatMs(r.lcp)} r={rate("lcp", r.lcp)} />
        <Metric label="CLS" value={formatCls(r.cls)} r={rate("cls", r.cls)} />
        <Metric label="TBT" value={formatMs(r.tbt)} r={rate("tbt", r.tbt)} />
        <Metric label="FCP" value={formatMs(r.fcp)} r={rate("fcp", r.fcp)} />
      </dl>
      {r.field && (
        <p className={`mt-2 text-xs ${muted}`}>
          Real visitors to this page: LCP {formatMs(r.field.lcp)} · INP {formatMs(r.field.inp)} · CLS {formatCls(r.field.cls)}
        </p>
      )}
      <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {ops.length ? "What to fix, biggest estimated saving first" : "Nothing significant to fix"}
      </h3>
      {ops.length > 0 && (
        <ul className="mt-2 space-y-2">
          {ops.map((o) => (
            <Opportunity key={o.id} o={o} />
          ))}
        </ul>
      )}
    </div>
  );
}

function savingsText(o: SpeedOpportunity): string | null {
  const parts: string[] = [];
  if (o.savings.lcp) parts.push(`LCP −${formatMs(o.savings.lcp)}`);
  else if (o.savings.fcp) parts.push(`FCP −${formatMs(o.savings.fcp)}`);
  if (o.savings.tbt) parts.push(`TBT −${formatMs(o.savings.tbt)}`);
  if (o.savings.cls) parts.push(`CLS −${o.savings.cls.toFixed(2)}`);
  return parts.length ? `Est. ${parts.join(", ")}` : null;
}

function Opportunity({ o }: { o: SpeedOpportunity }) {
  const savings = savingsText(o);
  return (
    <li className={`px-3 py-2 ${card}`}>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{o.title}</span>
          {o.displayValue && <span className={`text-xs ${muted}`}>{o.displayValue}</span>}
          {savings && <span className="text-xs text-amber-600 dark:text-amber-400">{savings}</span>}
          <span className={`ml-auto text-xs transition-transform group-open:rotate-90 ${muted}`} aria-hidden>
            ▸
          </span>
        </summary>
        <p className={`mt-2 text-sm ${muted}`}>
          {o.description}
          {o.learnMore && (
            <>
              {" "}
              <a href={o.learnMore} target="_blank" rel="noreferrer" className="underline">
                Learn more
              </a>
            </>
          )}
        </p>
        {o.items.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs">
            {o.items.map((it, i) => (
              <li key={i} className="flex min-w-0 gap-2">
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300" title={it.url}>
                  {it.url}
                </span>
                {it.detail && <span className={`shrink-0 ${muted}`}>{it.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}
