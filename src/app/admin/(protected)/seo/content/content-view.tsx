"use client";

/**
 * Content scan screens (phase 6, Ian 2026-10-13): a separate scan from the
 * technical audit — same crawl and session store, no link checks or speed
 * tests — showing the site topic map, what each page targets, and the
 * client's target phrases. The model is built in a worker once the scan
 * stops (see use-content-model.ts); nothing is stored beyond the tab.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ContentFinding, ContentModel, ContentPage, TargetResult, TopicPhrase, TopicSection } from "@/lib/seo/content/model";
import { FIELD_LABEL, MAX_TARGET_PHRASES } from "@/lib/seo/content/model";
import { CLARITY_LABEL } from "@/lib/seo/content/workbook";
import { activeAudit, isActive, prefillContentScan, setContentCounts, startAudit, stopAudit, useAuditRecord, type AuditRecord } from "../audit-store";
import { PhaseBadge } from "../audit-views";
import { StatTile, card, displayPath, formatDuration, muted } from "../report";
import { useContentModel } from "./use-content-model";

const btn =
  "rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900";
const primaryBtn =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
const linkCls =
  "text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-700 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:decoration-zinc-300";

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type Tab = "topics" | "pages" | "targets" | "findings";

export function ContentScanView({ id }: { id: string }) {
  const { hydrated, record } = useAuditRecord(id);
  const audit = record?.audit ?? null;
  const ready = !!record && !isActive(record) && !!audit && audit.pages.length > 0;
  const phrases = useMemo(() => record?.options.phrases ?? [], [record?.options.phrases]);
  const { model, working, error } = useContentModel(audit, phrases, ready);
  const [tab, setTab] = useState<Tab>("topics");

  useEffect(() => {
    if (!model || !record) return;
    let warnings = 0;
    let notices = 0;
    for (const f of model.findings) {
      if (f.severity === "warning") warnings += f.rows.length;
      else notices += f.rows.length;
    }
    setContentCounts(record.id, { warnings, notices });
  }, [model, record]);

  if (!record) {
    return (
      <div className="mt-6">
        {hydrated ? (
          <div className={`${card} px-4 py-6 text-sm`}>
            <p className="text-zinc-900 dark:text-zinc-50">This scan isn&apos;t available.</p>
            <p className={`mt-1 ${muted}`}>Results are only kept in the browser tab that ran them, until it&apos;s closed.</p>
            <Link href="/admin/seo" className="mt-3 inline-block font-medium underline underline-offset-2">
              Start a new scan
            </Link>
          </div>
        ) : (
          <p className={`text-sm ${muted}`}>Loading…</p>
        )}
      </div>
    );
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "topics", label: "Topic map" },
    { id: "pages", label: "Page focus", count: model?.pages.length },
    ...(phrases.length ? [{ id: "targets" as Tab, label: "Target phrases", count: phrases.length }] : []),
    { id: "findings", label: "Findings", count: model?.findings.reduce((n, f) => n + f.rows.length, 0) },
  ];

  return (
    <div>
      <Header record={record} />
      <Progress record={record} />
      {record.error && (
        <p
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            record.phase === "error"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {record.error}
        </p>
      )}
      {audit?.error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {audit.error}
        </p>
      )}
      {audit?.capReached && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Stopped at the {audit.pageLimit.toLocaleString("en-GB")}-page limit, so the topic map covers part of the site.
        </p>
      )}

      {isActive(record) ? (
        <p className={`mt-6 text-sm ${muted}`}>The topic map, page focus and target phrases appear when the scan finishes.</p>
      ) : !audit || audit.pages.length === 0 ? null : working ? (
        <p className={`mt-6 text-sm ${muted}`}>Working out what the site is about…</p>
      ) : error || !model ? (
        <p className="mt-6 text-sm text-red-600 dark:text-red-400">Couldn&apos;t analyse the pages: {error ?? "unknown error"}</p>
      ) : (
        <>
          <Summary model={model} phrases={phrases.length} />
          <TopicDownload record={record} model={model} />
          <nav className="-mx-1 mt-6 flex gap-1 overflow-x-auto px-1 text-sm" aria-label="Content scan views">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 ${
                  tab === t.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : `${muted} hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50`
                }`}
              >
                {t.label}
                {t.count !== undefined && <span className="text-xs tabular-nums opacity-70">{t.count}</span>}
              </button>
            ))}
          </nav>
          <div className="mt-4">
            {tab === "topics" && <TopicMap model={model} origin={audit.discovery.origin} />}
            {tab === "pages" && <PageFocus pages={model.pages} origin={audit.discovery.origin} />}
            {tab === "targets" && <Targets targets={model.targets} origin={audit.discovery.origin} />}
            {tab === "findings" && <Findings findings={model.findings} origin={audit.discovery.origin} />}
          </div>
          <Limits model={model} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ header + progress

function Header({ record }: { record: AuditRecord }) {
  const router = useRouter();
  const audit = record.audit;
  const active = isActive(record);
  const rerun = () => {
    try {
      const id = startAudit(record.requestedUrl, record.options);
      router.push(`/admin/seo/content/${id}`);
    } catch {
      router.push("/admin/seo");
    }
  };
  const phrases = record.options.phrases ?? [];
  return (
    <div>
      <nav className={`text-sm ${muted}`}>
        <Link href="/admin/seo" className="hover:text-zinc-900 dark:hover:text-zinc-50">
          SEO audits
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-zinc-900 dark:text-zinc-50">{host(record.requestedUrl)}</span>
      </nav>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{host(record.requestedUrl)}</h1>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
              Content scan
            </span>
            <PhaseBadge phase={record.phase} />
          </div>
          <p className={`mt-1 text-xs ${muted}`}>
            {audit?.discovery.startUrl ?? record.requestedUrl} · started{" "}
            {new Date(record.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            {audit && ` · ${formatDuration(audit.startedAt, audit.finishedAt)}`} · up to{" "}
            {record.options.pageLimit.toLocaleString("en-GB")} pages ·{" "}
            {phrases.length ? `${phrases.length} target phrase${phrases.length === 1 ? "" : "s"}` : "no target phrases"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {active ? (
            <button type="button" onClick={() => stopAudit(record.id)} className={btn}>
              Stop
            </button>
          ) : (
            <>
              <Link href="/admin/seo" onClick={() => prefillContentScan(record)} className={btn}>
                Change phrases
              </Link>
              <button type="button" onClick={rerun} disabled={!!activeAudit()} className={btn}>
                Run again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Progress({ record }: { record: AuditRecord }) {
  if (!isActive(record)) return null;
  const audit = record.audit;
  const fetched = audit?.pages.length ?? 0;
  const expected = Math.min(record.options.pageLimit, fetched + record.queued);
  const discovering = record.phase === "discovering" || !audit;
  const pct = expected > 0 ? Math.round((fetched / expected) * 100) : 0;
  const latest = audit?.pages[audit.pages.length - 1];
  return (
    <div className={`mt-6 p-4 ${card}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">
          {discovering ? "Reading robots.txt and sitemaps…" : audit?.stage === "rechecking" ? "Rechecking pages that failed…" : "Reading pages…"}
        </span>
        {!discovering && (
          <span className={`tabular-nums ${muted}`}>
            {fetched.toLocaleString("en-GB")} read · {record.queued.toLocaleString("en-GB")} queued
          </span>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-50 ${discovering ? "w-1/12 animate-pulse" : ""}`}
          style={discovering ? undefined : { width: `${Math.max(2, pct)}%` }}
        />
      </div>
      {latest && <p className={`mt-2 truncate text-xs ${muted}`}>Latest: {latest.url}</p>}
      {record.pacingNote && <p className={`mt-2 text-xs ${muted}`}>{record.pacingNote}</p>}
      <p className={`mt-2 text-xs ${muted}`}>You can move around the admin while this runs — keep this tab open.</p>
    </div>
  );
}

// ------------------------------------------------------------ summary + download

function Summary({ model, phrases }: { model: ContentModel; phrases: number }) {
  const targeted = model.targets.filter((t) => t.targeting.length > 0).length;
  const warnings = model.findings.filter((f) => f.severity === "warning").reduce((n, f) => n + f.rows.length, 0);
  const notices = model.findings.filter((f) => f.severity === "info").reduce((n, f) => n + f.rows.length, 0);
  const clear = model.pages.filter((p) => p.clarity === "clear").length;
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
      <div className="col-span-2 sm:col-span-1">
        <StatTile label="Pages analysed" value={model.pages.length.toLocaleString("en-GB")} />
      </div>
      <StatTile label="Clear focus" value={model.pages.length ? `${Math.round((clear / model.pages.length) * 100)}%` : "—"} />
      <StatTile label="Target phrases targeted" value={phrases ? `${targeted} of ${model.targets.length}` : "—"} tone={phrases && targeted < model.targets.length ? "warn" : undefined} />
      <StatTile label="Warnings" value={warnings} tone={warnings ? "warn" : undefined} />
      <StatTile label="Notices" value={notices} />
    </div>
  );
}

function TopicDownload({ record, model }: { record: AuditRecord; model: ContentModel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audit = record.audit!;
  const partial =
    record.phase === "stopped" || audit.status !== "complete"
      ? "Partial — the scan was stopped before it finished"
      : audit.capReached
        ? `Partial — stopped at the ${audit.pageLimit.toLocaleString("en-GB")}-page limit`
        : null;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const [{ buildTopicWorkbook, topicFileStem }, { buildXlsx }, { VELOCITY_B_BRAND }] = await Promise.all([
        import("@/lib/seo/content/workbook"),
        import("@/lib/seo/report/xlsx"),
        import("@/lib/seo/report/brand"),
      ]);
      const bytes = buildXlsx(buildTopicWorkbook(audit, model, partial), {
        title: `Site topic map — ${host(audit.discovery.startUrl)}`,
        creator: VELOCITY_B_BRAND.name,
        created: new Date(),
      });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${topicFileStem(audit)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(`Couldn't create the workbook: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${card} mt-6 px-4 py-4`} aria-label="Topic map download">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Topic map download</h2>
          <p className={`mt-0.5 text-xs ${muted}`}>
            Excel workbook: the topic map by section, and every page&apos;s focus phrase.
            {partial && " This scan didn't finish, so it's marked as partial."}
          </p>
        </div>
        <button type="button" onClick={run} disabled={busy} className={primaryBtn}>
          {busy ? "Creating…" : "Download topic map (.xlsx)"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

// ------------------------------------------------------------ topic map

function PhraseBars({ phrases, total, origin }: { phrases: TopicPhrase[]; total: number; origin: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (phrases.length === 0) return <p className={`px-4 py-3 text-sm ${muted}`}>No phrase stands out here.</p>;
  const max = Math.max(...phrases.map((p) => p.pages));
  return (
    <ol className="divide-y divide-zinc-100 dark:divide-zinc-900">
      {phrases.map((p) => (
        <li key={p.key}>
          <button
            type="button"
            onClick={() => setOpen(open === p.key ? null : p.key)}
            aria-expanded={open === p.key}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 text-left hover:bg-zinc-50 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] dark:hover:bg-zinc-900/50"
          >
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{p.text}</span>
            <span className="hidden h-1.5 overflow-hidden rounded-full bg-zinc-100 sm:block dark:bg-zinc-800">
              <span className="block h-full rounded-full bg-violet-500 dark:bg-violet-400" style={{ width: `${Math.max(4, (p.pages / max) * 100)}%` }} />
            </span>
            <span className={`text-xs tabular-nums ${muted}`}>
              {p.pages} of {total} page{total === 1 ? "" : "s"}
            </span>
          </button>
          {open === p.key && (
            <ul className="space-y-1 px-4 pb-3 text-sm">
              {p.examples.map((u) => (
                <li key={u} className="truncate">
                  <a href={u} target="_blank" rel="noreferrer noopener" className={linkCls}>
                    {displayPath(u, origin)}
                  </a>
                </li>
              ))}
              {p.pages > p.examples.length && <li className={`text-xs ${muted}`}>…and {p.pages - p.examples.length} more</li>}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function TopicMap({ model, origin }: { model: ContentModel; origin: string }) {
  return (
    <div>
      <p className={`max-w-3xl text-sm ${muted}`}>
        The phrases the site&apos;s own pages name most — in titles, headings, URLs, descriptions and opening paragraphs —
        weighted so phrases on every page count less. A quick read on what the site would plausibly be found for, and
        whether that matches the business. Click a phrase for example pages.
      </p>
      <section className={`mt-4 ${card}`}>
        <h2 className="flex items-baseline justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-900">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">Whole site</span>
          <span className={`text-xs ${muted}`}>{model.pages.length} pages</span>
        </h2>
        <PhraseBars phrases={model.site} total={model.pages.length} origin={origin} />
      </section>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {model.sections.map((s: TopicSection) => (
          <section key={s.id} className={`min-w-0 ${card}`}>
            <h2 className="flex items-baseline justify-between gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-900">
              <span className="truncate font-semibold text-zinc-900 dark:text-zinc-50">{s.label}</span>
              <span className={`shrink-0 text-xs ${muted}`}>{s.pageCount} pages</span>
            </h2>
            <PhraseBars phrases={s.phrases} total={s.pageCount} origin={origin} />
          </section>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ page focus

const CLARITY_STYLE: Record<ContentPage["clarity"], string> = {
  clear: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  mixed: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  weak: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  none: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function ClarityBadge({ clarity }: { clarity: ContentPage["clarity"] }) {
  return <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CLARITY_STYLE[clarity]}`}>{CLARITY_LABEL[clarity]}</span>;
}

function FieldChips({ fields }: { fields: (keyof typeof FIELD_LABEL)[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {fields.map((f) => (
        <span key={f} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {FIELD_LABEL[f]}
        </span>
      ))}
    </span>
  );
}

const PAGE_SIZE = 50;

function PageFocus({ pages, origin }: { pages: ContentPage[]; origin: string }) {
  const [filter, setFilter] = useState<"all" | ContentPage["clarity"]>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const rows = pages.filter(
    (p) =>
      (filter === "all" || p.clarity === filter) &&
      (!q || p.url.toLowerCase().includes(q) || (p.focus ?? "").toLowerCase().includes(q) || (p.title ?? "").toLowerCase().includes(q))
  );
  const shown = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pagesCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const counts = (c: ContentPage["clarity"]) => pages.filter((p) => p.clarity === c).length;
  return (
    <div>
      <p className={`max-w-3xl text-sm ${muted}`}>
        Each page&apos;s inferred focus phrase, from where phrases appear: title and H1 count most, then URL, meta
        description, subheadings, opening paragraph and main text. <b className="font-medium">Clear</b> = in the title and
        backed by the H1 or URL; <b className="font-medium">mixed signals</b> = title, H1 and URL disagree;{" "}
        <b className="font-medium">weak</b> = not in the title.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(["all", "clear", "mixed", "weak"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f);
              setPage(0);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {f === "all" ? `All ${pages.length}` : `${CLARITY_LABEL[f]} ${counts(f)}`}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Filter by URL, title or phrase"
          aria-label="Filter pages"
          className="ml-auto w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none sm:w-64 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        />
      </div>
      <div className={`mt-3 ${card}`}>
        {shown.length === 0 ? (
          <p className={`px-4 py-6 text-center text-sm ${muted}`}>No pages match.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {shown.map((p) => (
              <li key={p.url}>
                <button
                  type="button"
                  onClick={() => setOpen(open === p.url ? null : p.url)}
                  aria-expanded={open === p.url}
                  className="grid w-full grid-cols-1 gap-1 px-4 py-2.5 text-left hover:bg-zinc-50 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-center sm:gap-3 dark:hover:bg-zinc-900/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-zinc-900 dark:text-zinc-50">{displayPath(p.url, origin)}</span>
                    <span className={`block truncate text-xs ${muted}`}>{p.title ?? "(no title)"}</span>
                  </span>
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{p.focus ?? "—"}</span>
                  <ClarityBadge clarity={p.clarity} />
                </button>
                {open === p.url && (
                  <dl className="grid gap-x-4 gap-y-1.5 px-4 pb-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <dt className={muted}>Focus found in</dt>
                    <dd>
                      <FieldChips fields={p.focusFields} />
                    </dd>
                    <dt className={muted}>H1</dt>
                    <dd className="text-zinc-900 dark:text-zinc-50">{p.h1 ?? "—"}</dd>
                    {p.alsoAbout.length > 0 && (
                      <>
                        <dt className={muted}>Also about</dt>
                        <dd className="text-zinc-900 dark:text-zinc-50">{p.alsoAbout.join(" · ")}</dd>
                      </>
                    )}
                    {p.mixed && (
                      <>
                        <dt className={muted}>Mixed signals</dt>
                        <dd className="text-zinc-900 dark:text-zinc-50">{p.mixed}</dd>
                      </>
                    )}
                    <dt className={muted}>Section · words</dt>
                    <dd className="text-zinc-900 dark:text-zinc-50">
                      {p.section} · {p.words.toLocaleString("en-GB")} words of main text
                    </dd>
                    <dt className={muted}>Page</dt>
                    <dd className="truncate">
                      <a href={p.url} target="_blank" rel="noreferrer noopener" className={linkCls}>
                        Open page
                      </a>
                    </dd>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {pagesCount > 1 && (
        <div className={`mt-3 flex items-center justify-between text-xs ${muted}`}>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length}
          </span>
          <span className="flex gap-2">
            <button type="button" className={btn} disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button type="button" className={btn} disabled={page >= pagesCount - 1} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ target phrases

function Targets({ targets, origin }: { targets: TargetResult[]; origin: string }) {
  return (
    <div>
      <p className={`max-w-3xl text-sm ${muted}`}>
        For each phrase: the pages that target it (in the title, H1 or URL, with supporting signals) and where it appears on
        them. Matching allows for plurals, hyphens and word order. To try different phrases, change them and run the scan
        again.
      </p>
      <div className="mt-4 space-y-4">
        {targets.map((t) => (
          <section key={t.key} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-900">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">“{t.phrase}”</h2>
              {t.targeting.length ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Targeted by {t.targeting.length} page{t.targeting.length === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  No page targets this
                </span>
              )}
            </div>
            {t.targeting.length > 0 && (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {t.targeting.slice(0, 10).map((h) => (
                  <li key={h.url} className="grid gap-1 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center sm:gap-3">
                    <span className="min-w-0">
                      <a href={h.url} target="_blank" rel="noreferrer noopener" className={`block truncate text-sm ${linkCls}`}>
                        {displayPath(h.url, origin)}
                      </a>
                      <span className={`block truncate text-xs ${muted}`}>{h.title}</span>
                    </span>
                    <FieldChips fields={h.where} />
                  </li>
                ))}
                {t.targeting.length > 10 && <li className={`px-4 py-2 text-xs ${muted}`}>…and {t.targeting.length - 10} more</li>}
              </ul>
            )}
            <p className={`px-4 py-2.5 text-xs ${muted}`}>
              {t.mentions.length === 0
                ? t.targeting.length
                  ? "No other pages mention it."
                  : "Not mentioned anywhere on the site."
                : `${t.targeting.length ? "Also mentioned" : "Mentioned"} on ${t.mentions.length} other page${t.mentions.length === 1 ? "" : "s"}${
                    t.mentions[0].bodyCount ? `, most on ${displayPath(t.mentions[0].url, origin)} (${t.mentions[0].bodyCount}×)` : ""
                  }.`}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ findings

function Findings({ findings, origin }: { findings: ContentFinding[]; origin: string }) {
  if (findings.length === 0) {
    return (
      <div className={card}>
        <p className={`px-4 py-6 text-center text-sm ${muted}`}>No content findings.</p>
      </div>
    );
  }
  return (
    <div className={card}>
      {findings.map((f) => (
        <FindingBlock key={f.id} finding={f} origin={origin} />
      ))}
    </div>
  );
}

function FindingBlock({ finding, origin }: { finding: ContentFinding; origin: string }) {
  const [all, setAll] = useState(false);
  const rows = all ? finding.rows : finding.rows.slice(0, 12);
  const warn = finding.severity === "warning";
  return (
    <details className="group border-b border-zinc-100 last:border-0 dark:border-zinc-900">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
        <span className={`h-2 w-2 shrink-0 rounded-full ${warn ? "bg-amber-500" : "bg-sky-500"}`} aria-hidden />
        <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">{finding.title}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
            warn ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
          }`}
        >
          {finding.rows.length}
        </span>
        <span className={`hidden text-xs sm:inline ${muted}`}>{warn ? "Warning" : "Notice"}</span>
        <span className={`text-xs transition-transform group-open:rotate-90 ${muted}`} aria-hidden>
          ▸
        </span>
      </summary>
      <div className="px-4 pb-4 pl-9">
        <p className={`text-sm ${muted}`}>{finding.description}</p>
        <div className="mt-2 space-y-1 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-900 dark:bg-zinc-900/40 dark:text-zinc-300">
          <p>
            <b className="font-medium">Why it matters:</b> {finding.why}
          </p>
          <p>
            <b className="font-medium">How to fix:</b> {finding.how}
          </p>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={`${r.label}-${r.url ?? i}`} className="min-w-0">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">{r.label}</span>
              {r.url && (
                <>
                  {" "}
                  <a href={r.url} target="_blank" rel="noreferrer noopener" className={`break-all ${linkCls}`}>
                    {displayPath(r.url, origin)}
                  </a>
                </>
              )}
              {r.note && <span className={`block text-xs ${muted}`}>{r.note}</span>}
            </li>
          ))}
        </ul>
        {finding.rows.length > 12 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
            {all ? "Show fewer" : `Show all ${finding.rows.length}`}
          </button>
        )}
      </div>
    </details>
  );
}

function Limits({ model }: { model: ContentModel }) {
  return (
    <section className={`mt-8 text-xs ${muted}`}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">About this scan</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Shows what the site&apos;s own content says it&apos;s about. It doesn&apos;t include search volume, keyword
          difficulty or rankings — those need Google Search Console (free, for sites you have access to) or a paid tool.
        </li>
        <li>
          {model.pages.length.toLocaleString("en-GB")} pages analysed; {model.skipped.toLocaleString("en-GB")} not
          (redirects, errors, noindex pages, filtered or paginated listings, and pages whose canonical points elsewhere).
        </li>
        <li>
          Main text excludes navigation, header, footer and sidebars.{" "}
          {model.boilerplate.length > 0 && `Left out as brand or boilerplate: ${model.boilerplate.join(", ")}. `}People&apos;s
          names from author and team pages are left out of the topic map.
        </li>
        <li>English only. Pages are read as plain HTML, so text that only appears after JavaScript runs isn&apos;t seen.</li>
        <li>Up to {MAX_TARGET_PHRASES} target phrases per scan.</li>
      </ul>
    </section>
  );
}
