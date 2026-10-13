"use client";

/**
 * Phase 5a screens: the audit overview (one card per stage, headline
 * numbers, live while it runs) and the stage detail screens you click into.
 * Both read the session store, so they keep updating while the crawl runs
 * and survive moving between screens.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { computeFindings, summarise, type Finding } from "@/lib/seo/findings";
import type { AuditResult } from "@/lib/seo/types";
import { activeAudit, isActive, isContentScan, startAudit, stopAudit, useAuditRecord, type AuditPhase, type AuditRecord } from "./audit-store";
import {
  AiPanel,
  AuditBanners,
  CrawlSetup,
  FindingsList,
  Inventory,
  SeverityCounts,
  StatTile,
  card,
  formatDuration,
  muted,
} from "./report";
import { SpeedPanel } from "./speed-panel";
import { ReportDownload } from "./report-download";
import { STAGES, stageById, stageMetrics, stageStatus, type StageDef, type StageMetric, type StageStatus } from "./stages";

// ------------------------------------------------------------ small pieces

const PHASE_LABEL: Record<AuditPhase, string> = {
  discovering: "Starting",
  running: "Running",
  done: "Complete",
  stopped: "Stopped",
  error: "Failed",
};

const BADGE: Record<string, string> = {
  running: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  stopped: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  idle: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export function PhaseBadge({ phase }: { phase: AuditPhase }) {
  const tone = phase === "discovering" ? "running" : phase;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>
      {isActive({ phase } as AuditRecord) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {PHASE_LABEL[phase]}
    </span>
  );
}

const STAGE_LABEL: Record<StageStatus, string> = {
  waiting: "Waiting",
  running: "In progress",
  done: "Done",
  skipped: "Skipped",
  stopped: "Incomplete",
};

function StageBadge({ status }: { status: StageStatus }) {
  const tone = status === "waiting" || status === "skipped" ? "idle" : status;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>
      {status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STAGE_LABEL[status]}
    </span>
  );
}

function metricTone(m: StageMetric): string {
  return m.tone === "bad"
    ? "text-red-600 dark:text-red-400"
    : m.tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : m.tone === "good"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-zinc-900 dark:text-zinc-50";
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Findings recomputed from a deferred copy, so big audits don't stutter the UI. */
function useFindings(audit: AuditResult | null): { audit: AuditResult | null; findings: Finding[] } {
  const deferred = useDeferredValue(audit);
  const findings = useMemo(() => (deferred ? computeFindings(deferred) : []), [deferred]);
  return { audit: deferred, findings };
}

function MissingAudit({ hydrated }: { hydrated: boolean }) {
  return (
    <div className="mt-6">
      {hydrated ? (
        <div className={`${card} px-4 py-6 text-sm`}>
          <p className="text-zinc-900 dark:text-zinc-50">This audit isn&apos;t available.</p>
          <p className={`mt-1 ${muted}`}>
            Results are only kept in the browser tab that ran them, until it&apos;s closed.
          </p>
          <Link href="/admin/seo" className="mt-3 inline-block font-medium underline underline-offset-2">
            Start a new audit
          </Link>
        </div>
      ) : (
        <p className={`text-sm ${muted}`}>Loading…</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ header + progress

function AuditHeader({ record, crumb }: { record: AuditRecord; crumb?: StageDef }) {
  const router = useRouter();
  const audit = record.audit;
  const active = isActive(record);
  const rerun = () => {
    try {
      const id = startAudit(record.requestedUrl, record.options);
      router.push(`/admin/seo/audit/${id}`);
    } catch {
      router.push("/admin/seo");
    }
  };
  return (
    <div>
      <nav className={`text-sm ${muted}`}>
        <Link href="/admin/seo" className="hover:text-zinc-900 dark:hover:text-zinc-50">
          SEO audits
        </Link>
        <span className="mx-1.5">/</span>
        {crumb ? (
          <>
            <Link href={`/admin/seo/audit/${record.id}`} className="hover:text-zinc-900 dark:hover:text-zinc-50">
              {host(record.requestedUrl)}
            </Link>
            <span className="mx-1.5">/</span>
            <span className="text-zinc-900 dark:text-zinc-50">{crumb.title}</span>
          </>
        ) : (
          <span className="text-zinc-900 dark:text-zinc-50">{host(record.requestedUrl)}</span>
        )}
      </nav>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {crumb ? crumb.title : host(record.requestedUrl)}
            </h1>
            <PhaseBadge phase={record.phase} />
          </div>
          <p className={`mt-1 text-xs ${muted}`}>
            {audit?.discovery.startUrl ?? record.requestedUrl} · started{" "}
            {new Date(record.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            {audit && ` · ${formatDuration(audit.startedAt, audit.finishedAt)}`} · up to{" "}
            {record.options.pageLimit.toLocaleString("en-GB")} pages
            {!record.options.checkExternal && " · external links not checked"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {active ? (
            <button
              type="button"
              onClick={() => stopAudit(record.id)}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={rerun}
              disabled={!!activeAudit()}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Run again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** What the audit is doing right now. */
function ProgressPanel({ record }: { record: AuditRecord }) {
  if (!isActive(record)) return null;
  const audit = record.audit;
  const fetched = audit?.pages.length ?? 0;
  const expected = Math.min(record.options.pageLimit, fetched + record.queued);
  const lc = audit?.linkCheck;
  const stage = audit?.stage ?? "crawling";
  const speedRun = stage === "testing-speed";
  const afterCrawl = stage === "checking-links" || stage === "rechecking" || speedRun;
  const checked = lc?.results.length ?? 0;
  const linksTotal = lc?.total ?? 0;
  const speedDone = audit?.speed?.results.length ?? 0;
  const speedTotal = audit?.speed?.sample.length ?? 0;
  const pct = speedRun
    ? Math.round((speedDone / Math.max(1, speedTotal)) * 100)
    : afterCrawl
      ? Math.round((checked / Math.max(1, linksTotal)) * 100)
      : expected > 0
        ? Math.round((fetched / expected) * 100)
        : 0;
  const discovering = record.phase === "discovering" || !audit;
  const label = discovering
    ? "Reading robots.txt, sitemaps and site addresses…"
    : speedRun
      ? `Testing page speed on ${speedTotal} sample pages with Lighthouse…`
      : stage === "rechecking"
        ? "Rechecking pages that failed…"
        : stage === "checking-links"
          ? "Checking this site's files and images, and any remaining links…"
          : "Crawling pages and checking links as they're found…";
  const latest = audit?.pages[audit.pages.length - 1];
  return (
    <div className={`mt-6 p-4 ${card}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
        {!discovering && (
          <span className={`tabular-nums ${muted}`}>
            {speedRun
              ? `${speedDone} of ${speedTotal} pages tested · about 15s each, 4 at a time`
              : afterCrawl
                ? `${fetched.toLocaleString("en-GB")} pages crawled`
                : `${fetched.toLocaleString("en-GB")} fetched · ${record.queued.toLocaleString("en-GB")} queued`}
            {!speedRun && linksTotal > 0 && ` · ${checked.toLocaleString("en-GB")} of ${linksTotal.toLocaleString("en-GB")} links checked`}
          </span>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-50 ${discovering ? "w-1/12 animate-pulse" : ""}`}
          style={discovering ? undefined : { width: `${Math.max(2, pct)}%` }}
        />
      </div>
      {latest && !afterCrawl && (
        <p className={`mt-2 truncate text-xs ${muted}`}>Latest: {latest.url}</p>
      )}
      {record.pacingNote && <p className={`mt-2 text-xs ${muted}`}>{record.pacingNote}</p>}
      {!discovering && !afterCrawl && (
        <p className={`mt-2 text-xs ${muted}`}>
          Site-wide numbers (orphans, sitemap gaps, click depth) settle once the crawl finishes.
        </p>
      )}
      <p className={`mt-2 text-xs ${muted}`}>
        You can open any stage or move around the admin while this runs — keep this tab open.
      </p>
    </div>
  );
}

function RecordErrors({ record }: { record: AuditRecord }) {
  if (!record.error) return null;
  const tone =
    record.phase === "error"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";
  return <p className={`mt-4 rounded-md border px-4 py-3 text-sm ${tone}`}>{record.error}</p>;
}

// ------------------------------------------------------------ overview

/** A content scan opened at an audit URL goes to its own screen. */
function useContentRedirect(record: AuditRecord | undefined) {
  const router = useRouter();
  const content = !!record && isContentScan(record);
  useEffect(() => {
    if (content && record) router.replace(`/admin/seo/content/${record.id}`);
  }, [content, record, router]);
  return content;
}

export function AuditOverview({ id }: { id: string }) {
  const { hydrated, record } = useAuditRecord(id);
  const content = useContentRedirect(record);
  const { audit, findings } = useFindings(content ? null : (record?.audit ?? null));
  if (!record) return <MissingAudit hydrated={hydrated} />;
  if (content) return null;
  const s = audit ? summarise(audit, findings) : null;

  return (
    <div>
      <AuditHeader record={record} />
      <ProgressPanel record={record} />
      <RecordErrors record={record} />
      {audit && <AuditBanners audit={audit} />}
      <ReportDownload record={record} />

      {s && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="col-span-2 sm:col-span-1">
            <StatTile label="Pages crawled" value={s.pagesCrawled.toLocaleString("en-GB")} />
          </div>
          <StatTile label="Broken links" value={s.brokenLinks} tone={s.brokenLinks ? "bad" : undefined} />
          <StatTile label="Errors" value={s.errors} tone={s.errors ? "bad" : undefined} />
          <StatTile label="Warnings" value={s.warnings} tone={s.warnings ? "warn" : undefined} />
          <StatTile label="Notices" value={s.notices} />
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((stage) => (
          <StageCard key={stage.id} stage={stage} record={record} audit={audit} findings={findings} />
        ))}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  record,
  audit,
  findings,
}: {
  stage: StageDef;
  record: AuditRecord;
  audit: AuditResult | null;
  findings: Finding[];
}) {
  const status = stageStatus(stage.id, audit, record.phase);
  const owned = findings.filter(stage.owns);
  const metrics = audit ? stageMetrics(stage.id, audit, findings) : [];
  const clickable = !!audit;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{stage.title}</h2>
        <StageBadge status={status} />
      </div>
      <p className={`mt-0.5 text-xs ${muted}`}>{stage.blurb}</p>
      {metrics.length > 0 ? (
        <dl className="mt-4 grid grid-cols-3 gap-2">
          {metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className={`text-xs leading-tight ${muted}`}>
                {m.label}
              </dt>
              <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${metricTone(m)}`}>{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className={`mt-4 h-[3.25rem] text-xs ${muted}`}>{status === "running" ? "Working…" : "Not started yet."}</div>
      )}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
        {audit ? <SeverityCounts findings={owned} /> : <span />}
        {clickable && <span className="text-xs font-medium text-zinc-900 dark:text-zinc-50">Explore →</span>}
      </div>
    </>
  );
  const cls = `block p-4 ${card}`;
  return clickable ? (
    <Link href={`/admin/seo/audit/${record.id}/${stage.id}`} className={`${cls} transition-colors hover:border-zinc-400 dark:hover:border-zinc-600`}>
      {body}
    </Link>
  ) : (
    <div className={`${cls} opacity-70`}>{body}</div>
  );
}

// ------------------------------------------------------------ stage detail

export function StageDetail({ id, stageId }: { id: string; stageId: string }) {
  const { hydrated, record } = useAuditRecord(id);
  const content = useContentRedirect(record);
  const { audit, findings } = useFindings(content ? null : (record?.audit ?? null));
  const stage = stageById(stageId);
  if (!record) return <MissingAudit hydrated={hydrated} />;
  if (content) return null;
  if (!stage) return <MissingAudit hydrated />;

  const owned = findings.filter(stage.owns);
  const status = stageStatus(stage.id, audit, record.phase);
  const live = isActive(record);

  return (
    <div>
      <AuditHeader record={record} crumb={stage} />
      <StageTabs record={record} audit={audit} findings={findings} current={stage.id} />
      <ProgressPanel record={record} />
      <RecordErrors record={record} />

      {!audit ? (
        <p className={`mt-6 text-sm ${muted}`}>This stage starts once the site has been read.</p>
      ) : (
        <>
          <AuditBanners audit={audit} />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className={`text-sm ${muted}`}>{stage.blurb}</p>
            <StageBadge status={status} />
          </div>
          {/* Page speed shows its own, fuller score panel instead. */}
          <div className={`mt-3 grid grid-cols-3 gap-3 ${stage.id === "speed" ? "hidden" : ""}`}>
            {stageMetrics(stage.id, audit, findings).map((m) => (
              <div key={m.label} className={`min-w-0 px-4 py-3 ${card}`}>
                <div className={`text-xs leading-tight ${muted}`}>{m.label}</div>
                <div className={`mt-1 truncate text-xl font-semibold tabular-nums ${metricTone(m)}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {stage.id === "discovery" ? (
            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              <CrawlSetup audit={audit} />
              <div className="min-w-0 [&>section]:mt-0">
                <AiPanel audit={audit} />
              </div>
            </div>
          ) : null}
          {stage.id === "speed" && <SpeedPanel record={record} audit={audit} />}

          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Findings</h2>
              <SeverityCounts findings={owned} />
            </div>
            <div className="mt-3">
              <FindingsList
                findings={owned}
                origin={audit.discovery.origin}
                live={live}
                showCategories={new Set(owned.map((f) => f.category)).size > 1}
              />
            </div>
          </section>

          {stage.id === "crawl" && <Inventory audit={audit} findings={findings} />}
        </>
      )}
    </div>
  );
}

function StageTabs({
  record,
  audit,
  findings,
  current,
}: {
  record: AuditRecord;
  audit: AuditResult | null;
  findings: Finding[];
  current: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // On a phone the tab row scrolls; keep the current stage in view.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const row = ref.current;
    if (el && row) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [current]);
  return (
    <div ref={ref} className="relative -mx-1 mt-5 overflow-x-auto">
      <nav className="flex min-w-max gap-1 px-1 text-sm" aria-label="Audit stages">
        <Link
          href={`/admin/seo/audit/${record.id}`}
          className={`rounded-md px-3 py-1.5 ${muted} hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50`}
        >
          Overview
        </Link>
        {STAGES.map((s) => {
          const issues = findings.filter(s.owns).filter((f) => f.severity !== "info").length;
          const status = stageStatus(s.id, audit, record.phase);
          const active = s.id === current;
          return (
            <Link
              key={s.id}
              href={`/admin/seo/audit/${record.id}/${s.id}`}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : `${muted} hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50`
              }`}
            >
              {s.title}
              {status === "running" ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
              ) : issues > 0 ? (
                <span className={`text-xs tabular-nums ${active ? "" : "text-amber-600 dark:text-amber-400"}`}>{issues}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
