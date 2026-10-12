"use client";

import { Fragment, useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  isBrokenPage,
  isOnSite,
  type Category,
  type Finding,
  type LinkSource,
  type Severity,
} from "@/lib/seo/findings";
import { urlKey } from "@/lib/seo/urls";
import { codeSegments, guidanceFor } from "@/lib/seo/guidance";
import { AI_BOTS, AI_GROUP_LABELS, type AiBotGroup } from "@/lib/seo/ai-bots";
import type { AuditPage, AuditResult } from "@/lib/seo/types";

const SEVERITY_STYLE: Record<Severity, { chip: string; label: string; dot: string }> = {
  error: {
    chip: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    dot: "bg-red-500",
    label: "Error",
  },
  warning: {
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    dot: "bg-amber-500",
    label: "Warning",
  },
  info: {
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
    dot: "bg-sky-500",
    label: "Notice",
  },
};

export const card = "rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
export const muted = "text-zinc-500 dark:text-zinc-400";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(startIso: string, endIso: string | null): string {
  const ms = (endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso);
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function displayPath(url: string, origin: string): string {
  try {
    const u = new URL(url);
    if (u.origin === origin) return `${u.pathname}${u.search}` || "/";
    return url;
  } catch {
    return url;
  }
}

export function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: "bad" | "warn" }) {
  const toneClass =
    tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className={`${card} px-4 py-3`}>
      <div className={`text-xs ${muted}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ page }: { page: AuditPage }) {
  let cls = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (isBrokenPage(page)) cls = "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  else if (page.redirectChain.length > 0) cls = "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  const label = page.status === 0 ? "Failed" : page.redirectChain.length > 0 ? `${page.redirectChain[0].status} → ${page.status}` : String(page.status);
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}>{label}</span>;
}

const URL_PREVIEW = 25;
const SOURCE_PREVIEW = 3;

/** "on /page — “link text”" lines under a broken URL. */
function SourceList({ sources, origin }: { sources: LinkSource[]; origin: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, SOURCE_PREVIEW);
  return (
    <ul className={`mt-0.5 mb-1.5 space-y-0.5 border-l border-zinc-200 pl-3 text-xs dark:border-zinc-800 ${muted}`}>
      {shown.map((src) => (
        <li key={src.page} className="truncate">
          on{" "}
          <a href={src.page} target="_blank" rel="noreferrer noopener" className="text-zinc-600 underline decoration-zinc-300 underline-offset-2 dark:text-zinc-300 dark:decoration-zinc-700">
            {displayPath(src.page, origin)}
          </a>
          {src.text && <span> — “{src.text}”</span>}
        </li>
      ))}
      {sources.length > SOURCE_PREVIEW && (
        <li>
          <button type="button" onClick={() => setAll((v) => !v)} className="font-medium hover:text-zinc-900 dark:hover:text-zinc-50">
            {all ? "Show fewer" : `+ ${sources.length - SOURCE_PREVIEW} more`}
          </button>
        </li>
      )}
    </ul>
  );
}

/** Inline code for guidance text (`backticks` mark code). */
function GuidanceText({ text }: { text: string }) {
  return (
    <>
      {codeSegments(text).map((seg, i) =>
        seg.code ? (
          <code key={i} className="rounded bg-zinc-100 px-1 font-mono text-[0.9em] dark:bg-zinc-800">
            {seg.text}
          </code>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        )
      )}
    </>
  );
}

/**
 * "Why it matters / how to fix" from the shared guidance lookup — the same
 * copy the public /seo-guide page, PDF and workbook use. Coverage notes
 * (kind "note") add nothing beyond the finding's own description here.
 */
function FindingGuidance({ id }: { id: string }) {
  const g = guidanceFor(id);
  if (!g || g.kind !== "issue") return null;
  return (
    <div className="mt-3 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2 sm:gap-4 dark:text-zinc-300">
      <div className="min-w-0">
        <p className={`text-xs font-medium ${muted}`}>Why it matters</p>
        <p className="mt-0.5"><GuidanceText text={g.why} /></p>
      </div>
      <div className="min-w-0">
        <p className={`text-xs font-medium ${muted}`}>How to fix</p>
        <p className="mt-0.5">
          <GuidanceText text={g.how} />{" "}
          <a href={`/seo-guide#${id}`} target="_blank" rel="noreferrer" className={`whitespace-nowrap text-xs underline underline-offset-2 ${muted}`}>
            Guide
          </a>
        </p>
      </div>
    </div>
  );
}

function FindingItem({ finding, origin }: { finding: Finding; origin: string }) {
  const [showAll, setShowAll] = useState(false);
  const style = SEVERITY_STYLE[finding.severity];
  const visible = showAll ? finding.urls : finding.urls.slice(0, URL_PREVIEW);
  return (
    <details className="group border-b border-zinc-100 last:border-0 dark:border-zinc-900">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">{finding.title}</span>
        {finding.urls.length > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${style.chip}`}>{finding.urls.length}</span>
        )}
        <span className={`hidden text-xs sm:inline ${muted}`}>{style.label}</span>
        <span className={`text-xs transition-transform group-open:rotate-90 ${muted}`} aria-hidden>
          ▸
        </span>
      </summary>
      <div className="px-4 pb-4 pl-9">
        <p className={`text-sm ${muted}`}>{finding.description}</p>
        <FindingGuidance id={finding.id} />
        {finding.caveat && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {finding.caveat}
          </p>
        )}
        {visible.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {visible.map((u) => (
              <li key={u}>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <a href={u} target="_blank" rel="noreferrer noopener" className="min-w-0 max-w-full truncate text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-700 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:decoration-zinc-300">
                    {displayPath(u, origin)}
                  </a>
                  {finding.notes?.[u] && (
                    <span className={`min-w-0 max-w-full truncate text-xs ${muted}`} title={finding.notes[u]}>
                      {finding.notes[u]}
                    </span>
                  )}
                </div>
                {finding.sources?.[u] && finding.sources[u].length > 0 && (
                  <SourceList sources={finding.sources[u]} origin={origin} />
                )}
              </li>
            ))}
          </ul>
        )}
        {finding.urls.length > URL_PREVIEW && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
            {showAll ? "Show fewer" : `Show all ${finding.urls.length}`}
          </button>
        )}
      </div>
    </details>
  );
}

type SortKey = "url" | "status" | "depth" | "timeMs" | "sizeBytes" | "inlinkCount" | "issues";
type Filter = "all" | "issues" | "ok" | "redirect" | "broken" | "unlisted";
const PAGE_SIZE = 50;

interface PageIssue {
  finding: Finding;
  note?: string;
}

/** urlKey → the findings that name that URL (once each). */
function indexIssues(findings: Finding[]): Map<string, PageIssue[]> {
  const index = new Map<string, PageIssue[]>();
  for (const f of findings) {
    for (const u of f.urls) {
      const key = urlKey(u);
      let list = index.get(key);
      if (!list) index.set(key, (list = []));
      if (!list.some((i) => i.finding.id === f.id)) list.push({ finding: f, note: f.notes?.[u] });
    }
  }
  return index;
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function issuesFor(p: AuditPage, index: Map<string, PageIssue[]>): PageIssue[] {
  const a = index.get(urlKey(p.url)) ?? [];
  const finalKey = urlKey(p.finalUrl);
  const b = finalKey === urlKey(p.url) ? [] : index.get(finalKey) ?? [];
  const merged = [...a, ...b.filter((x) => !a.some((y) => y.finding.id === x.finding.id))];
  return merged.sort((x, y) => SEVERITY_RANK[x.finding.severity] - SEVERITY_RANK[y.finding.severity]);
}

function Field({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className={`text-xs ${muted}`}>
        {label}
        {hint && <span className="ml-1 tabular-nums">· {hint}</span>}
      </dt>
      <dd className={`mt-0.5 break-words text-sm ${value ? "text-zinc-900 dark:text-zinc-50" : muted}`}>{value || "—"}</dd>
    </div>
  );
}

function PageDetails({ page, issues }: { page: AuditPage; issues: PageIssue[] }) {
  const op = page.onPage;
  return (
    <div className="space-y-4 bg-zinc-50 px-4 py-4 dark:bg-zinc-900/40">
      {issues.length > 0 && (
        <ul className="space-y-1.5">
          {issues.map(({ finding, note }) => (
            <li key={finding.id} className="flex items-baseline gap-2 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 self-start rounded-full ${SEVERITY_STYLE[finding.severity].dot}`} aria-hidden />
              <span className="text-zinc-900 dark:text-zinc-50">{finding.title}</span>
              {note && <span className={`min-w-0 truncate text-xs ${muted}`}>{note}</span>}
            </li>
          ))}
        </ul>
      )}
      {op ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Title" value={page.title} hint={page.title ? `${page.title.length} chars` : undefined} />
          <Field
            label="Meta description"
            value={op.metaDescription}
            hint={op.metaDescription ? `${op.metaDescription.length} chars` : undefined}
          />
          <Field label={op.h1s.length > 1 ? `H1 headings (${op.h1s.length})` : "H1 heading"} value={op.h1s.filter(Boolean).join(" · ")} />
          <Field label="Canonical" value={op.canonical} />
          <Field label="Robots" value={[op.metaRobots, op.xRobotsTag && `X-Robots-Tag: ${op.xRobotsTag}`].filter(Boolean).join(" · ") || null} />
          <Field label="Language" value={op.lang} />
          <Field label="og:title" value={op.ogTitle} />
          <Field label="og:image" value={op.ogImage} />
          <Field
            label="Images"
            value={op.imageCount ? `${op.imageCount} total, ${op.imagesMissingAlt} without alt text` : "None"}
          />
          <Field label="Links" value={`${page.internalLinks.length} internal, ${page.externalLinkCount} external`} />
          <Field label="Main text" value={op.wordCount !== undefined ? `${op.wordCount.toLocaleString("en-GB")} words` : null} />
          <Field
            label="Mobile viewport · compression"
            value={`${op.hasViewport === false ? "No viewport tag" : "Viewport set"} · ${page.contentEncoding ? page.contentEncoding : "uncompressed"}`}
          />
          <Field
            label="Structured data"
            value={
              [
                ...new Set([
                  ...(op.structuredData?.items.flatMap((i) => i.types) ?? []),
                  ...(op.structuredData?.microdataTypes ?? []).map((t) => `${t} (microdata)`),
                ]),
              ].join(", ") || (op.structuredData?.parseErrors.length ? "Invalid JSON-LD" : null)
            }
          />
        </dl>
      ) : (
        <p className={`text-sm ${muted}`}>
          {page.error ?? (page.isHtml ? `No on-page data (HTTP ${page.status}).` : `Not an HTML page (${page.contentType ?? "unknown type"}).`)}
        </p>
      )}
      {page.redirectChain.length > 0 && (
        <p className={`break-all text-xs ${muted}`}>
          Redirects: {page.redirectChain.map((h) => `${h.url} (${h.status})`).join(" → ")} → {page.finalUrl}
        </p>
      )}
    </div>
  );
}

export function Inventory({ audit, findings }: { audit: AuditResult; findings: Finding[] }) {
  const { origin } = audit.discovery;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "depth", dir: 1 });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const issueIndex = useMemo(() => indexIssues(findings), [findings]);
  const issuesByUrl = useMemo(
    () => new Map(audit.pages.map((p) => [p.url, issuesFor(p, issueIndex)])),
    [audit.pages, issueIndex]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = audit.pages.filter((p) => {
      if (q && !p.url.toLowerCase().includes(q) && !(p.title ?? "").toLowerCase().includes(q)) return false;
      switch (filter) {
        case "issues":
          return (issuesByUrl.get(p.url)?.length ?? 0) > 0;
        case "ok":
          return !isBrokenPage(p) && p.redirectChain.length === 0;
        case "redirect":
          return p.redirectChain.length > 0;
        case "broken":
          return isBrokenPage(p);
        case "unlisted":
          return !p.inSitemap && isOnSite(p, origin) && p.isHtml && p.status === 200;
        default:
          return true;
      }
    });
    const val = (p: AuditPage): string | number => {
      switch (sort.key) {
        case "url":
          return p.url;
        case "depth":
          return p.depth ?? Number.MAX_SAFE_INTEGER;
        case "issues":
          return issuesByUrl.get(p.url)?.length ?? 0;
        default:
          return p[sort.key];
      }
    };
    return filtered.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [audit.pages, query, filter, sort, origin, issuesByUrl]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function header(key: SortKey, label: string, align = "text-left") {
    const active = sort.key === key;
    return (
      <th className={`px-3 py-2 font-medium ${align}`}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))}
          className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-50 ${active ? "text-zinc-900 dark:text-zinc-50" : ""}`}
        >
          {label}
          <span className="text-[10px]" aria-hidden>
            {active ? (sort.dir === 1 ? "▲" : "▼") : ""}
          </span>
        </button>
      </th>
    );
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "issues", label: "Has issues" },
    { id: "ok", label: "OK" },
    { id: "redirect", label: "Redirects" },
    { id: "broken", label: "Broken" },
  ];
  if (audit.discovery.sitemap.found) filters.push({ id: "unlisted", label: "Not in sitemap" });

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Page inventory</h2>
          <p className={`text-xs ${muted}`}>Click a row to see its on-page details and issues.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-zinc-300 text-xs dark:border-zinc-700">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFilter(f.id);
                  setPage(1);
                }}
                className={`px-2.5 py-1.5 ${filter === f.id ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Filter by URL or title…"
            aria-label="Filter pages"
            className="w-56 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </div>
      </div>

      <div className={`mt-3 overflow-x-auto ${card}`}>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              {header("url", "Page")}
              {header("status", "Status")}
              {header("issues", "Issues", "text-right")}
              {header("depth", "Depth", "text-right")}
              {header("inlinkCount", "Inlinks", "text-right")}
              <th className="px-3 py-2 font-medium">Sitemap</th>
              {header("timeMs", "Time", "text-right")}
              {header("sizeBytes", "Size", "text-right")}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className={`px-3 py-6 text-center text-sm ${muted}`}>
                  No pages match.
                </td>
              </tr>
            ) : (
              visible.map((p) => {
                const issues = issuesByUrl.get(p.url) ?? [];
                const worst = issues[0]?.finding.severity;
                const isOpen = open === p.url;
                return (
                <Fragment key={p.url}>
                <tr
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    setOpen(isOpen ? null : p.url);
                  }}
                  aria-expanded={isOpen}
                  className={`cursor-pointer border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/40 ${isOpen ? "bg-zinc-50 dark:bg-zinc-900/40" : ""}`}
                >
                  <td className="max-w-[22rem] px-3 py-2">
                    <a href={p.url} target="_blank" rel="noreferrer noopener" className="block truncate text-zinc-900 hover:underline dark:text-zinc-50" title={p.url}>
                      {displayPath(p.url, origin)}
                    </a>
                    <div className={`truncate text-xs ${muted}`} title={p.title ?? undefined}>
                      {p.error ?? p.title ?? (p.isHtml ? "No title" : p.contentType ?? "—")}
                    </div>
                    {p.redirectChain.length > 0 && (
                      <div className={`truncate text-xs ${muted}`} title={p.finalUrl}>
                        → {displayPath(p.finalUrl, origin)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge page={p} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {issues.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                        <span className={`h-2 w-2 rounded-full ${SEVERITY_STYLE[worst!].dot}`} aria-hidden />
                        {issues.length}
                      </span>
                    ) : (
                      <span className={muted}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{p.depth ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{p.inlinkCount}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{p.inSitemap ? "Yes" : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{p.status ? `${p.timeMs} ms` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{p.sizeBytes ? formatBytes(p.sizeBytes) : "—"}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-900">
                    <td colSpan={8} className="p-0">
                      <PageDetails page={p} issues={issues} />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={`mt-3 flex items-center justify-between text-xs ${muted}`}>
        <span>
          {rows.length === 0 ? "0 pages" : `${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, rows.length)} of ${rows.length}`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700">
              Previous
            </button>
            <span>
              Page {current} of {totalPages}
            </span>
            <button type="button" disabled={current >= totalPages} onClick={() => setPage(current + 1)} className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700">
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function Chip({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const cls =
    ok === null
      ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      : ok
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  return <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** Report-only panel (Ian's decision): allowed/blocked per AI bot, no severity. */
export function AiPanel({ audit }: { audit: AuditResult }) {
  const ai = audit.discovery.ai;
  if (!ai) return null;
  const groups: AiBotGroup[] = ["search", "user", "training"];
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI crawler access</h2>
      <div className={`mt-3 text-sm ${card}`}>
        {groups.map((g) => (
          <div key={g} className="border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-900">
            <div className={`text-xs ${muted}`}>{AI_GROUP_LABELS[g]}</div>
            <ul className="mt-1.5 space-y-1">
              {AI_BOTS.filter((b) => b.group === g).map((bot) => {
                const access = ai.bots.find((b) => b.token === bot.token);
                if (!access) return null;
                const blocked = !access.allowedRoot || !access.allowedStart;
                return (
                  <li key={bot.token} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 text-zinc-900 dark:text-zinc-50" title={`${bot.vendor} — ${bot.purpose}`}>
                      <span className="block truncate">
                        {bot.token} <span className={`text-xs ${muted}`}>· {bot.vendor}</span>
                      </span>
                      {bot.mayIgnoreRobots && (
                        <span className={`block text-xs ${muted}`}>{bot.vendor} says it may ignore robots.txt</span>
                      )}
                    </span>
                    <Chip ok={!blocked}>
                      {blocked ? (access.allowedRoot ? "Start page blocked" : "Blocked") : "Allowed"}
                    </Chip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-zinc-900 dark:text-zinc-50">
            llms.txt
            {ai.llmsTxt.detail && <span className={`block text-xs ${muted}`}>{ai.llmsTxt.detail}</span>}
          </span>
          <Chip ok={ai.llmsTxt.status === "found" ? true : null}>
            {ai.llmsTxt.status === "found" ? "Found" : ai.llmsTxt.status === "html" ? "Not a real file" : ai.llmsTxt.status === "error" ? "Couldn't read" : "None"}
          </Chip>
        </div>
      </div>
      <p className={`mt-2 text-xs leading-relaxed ${muted}`}>
        From robots.txt. Blocking training bots is a legitimate choice; blocking AI search and answer bots means the
        site can&apos;t be cited in AI answers.
      </p>
    </section>
  );
}

/** Error / page-limit banners shown at the top of every audit screen. */
export function AuditBanners({ audit }: { audit: AuditResult }) {
  return (
    <>
      {audit.error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {audit.error} {audit.pages.length > 0 && "Results cover what was crawled before it stopped."}
        </p>
      )}
      {audit.capReached && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Stopped at the {audit.pageLimit.toLocaleString("en-GB")}-page limit. The site has more pages than were crawled,
          so site-wide findings (orphans, sitemap gaps, click depth) are provisional.
        </p>
      )}
    </>
  );
}

/** Findings, grouped by category (only categories that have findings are shown). */
export function FindingsList({
  findings,
  origin,
  live,
  showCategories = true,
}: {
  findings: Finding[];
  origin: string;
  live: boolean;
  showCategories?: boolean;
}) {
  if (findings.length === 0) {
    return (
      <div className={card}>
        <p className={`px-4 py-6 text-center text-sm ${muted}`}>
          {live ? "Nothing yet — findings appear as the audit runs." : "No issues found here."}
        </p>
      </div>
    );
  }
  return (
    <div className={card}>
      {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => {
        const group = findings.filter((f) => f.category === cat);
        if (group.length === 0) return null;
        return (
          <div key={cat}>
            {showCategories && (
              <h3 className={`border-b border-zinc-100 bg-zinc-50 px-4 py-1.5 text-xs font-medium uppercase tracking-wide first:rounded-t-md dark:border-zinc-900 dark:bg-zinc-900/40 ${muted}`}>
                {CATEGORY_LABELS[cat]}
              </h3>
            )}
            {group.map((f) => (
              <FindingItem key={f.id} finding={f} origin={origin} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Severity counts for a set of findings (URL-weighted, as in the summary). */
export function SeverityCounts({ findings }: { findings: Finding[] }) {
  const n = (sev: Severity) =>
    findings.filter((f) => f.severity === sev).reduce((t, f) => t + Math.max(1, f.urls.length), 0);
  return (
    <div className={`flex gap-3 text-xs ${muted}`}>
      <span><span className="font-medium text-red-600 dark:text-red-400">{n("error")}</span> errors</span>
      <span><span className="font-medium text-amber-600 dark:text-amber-400">{n("warning")}</span> warnings</span>
      <span><span className="font-medium text-sky-600 dark:text-sky-400">{n("info")}</span> notices</span>
    </div>
  );
}

/** robots.txt, sitemap, link checks, site addresses, page limit. */
export function CrawlSetup({ audit }: { audit: AuditResult }) {
  const { discovery } = audit;
  return (
    <section className="min-w-0">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Crawl setup</h2>
          <dl className={`mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-900 ${card}`}>
            <div className="px-4 py-3">
              <dt className={`text-xs ${muted}`}>Start URL</dt>
              <dd className="mt-0.5 break-all text-zinc-900 dark:text-zinc-50">{discovery.startUrl}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className={`text-xs ${muted}`}>robots.txt</dt>
              <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
                {discovery.robots.found
                  ? `Found · ${discovery.robots.rules.length} rule${discovery.robots.rules.length === 1 ? "" : "s"} apply to us`
                  : discovery.robots.error ?? "Not found"}
                {discovery.robots.crawlDelay !== null && ` · crawl delay ${discovery.robots.crawlDelay}s`}
              </dd>
            </div>
            <div className="px-4 py-3">
              <dt className={`text-xs ${muted}`}>XML sitemap</dt>
              <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
                {discovery.sitemap.found
                  ? `${discovery.sitemap.urls.length} URLs from ${discovery.sitemap.sources.length} file${discovery.sitemap.sources.length === 1 ? "" : "s"}${discovery.sitemap.truncated ? " (partly read)" : ""}`
                  : "Not found"}
                {discovery.sitemap.offSiteCount > 0 && (
                  <span className={`block text-xs ${muted}`}>{discovery.sitemap.offSiteCount} off-site URLs ignored</span>
                )}
              </dd>
            </div>
            <div className="px-4 py-3">
              <dt className={`text-xs ${muted}`}>Links, files &amp; images checked</dt>
              <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
                {!audit.linkCheck || audit.linkCheck.status === "pending"
                  ? "After the crawl"
                  : audit.linkCheck.status === "skipped"
                    ? "Skipped (crawl didn't finish)"
                    : `${audit.linkCheck.results.length.toLocaleString("en-GB")} of ${audit.linkCheck.found.toLocaleString("en-GB")}${
                        audit.linkCheck.status === "running" ? " so far" : audit.linkCheck.status === "cancelled" ? " (stopped early)" : ""
                      }`}
              </dd>
            </div>
            {discovery.hosts?.length > 0 && (
              <div className="px-4 py-3">
                <dt className={`text-xs ${muted}`}>Site addresses</dt>
                <dd className="mt-1 space-y-1">
                  {discovery.hosts.map((h) => {
                    const isMain = new URL(h.url).origin === discovery.origin;
                    const ok = isMain ? !h.error && h.status < 400 : h.reachesCanonical;
                    return (
                      <div key={h.url} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">{h.url.replace(/\/$/, "")}</span>
                        <Chip ok={h.error && /domain not found/i.test(h.error) ? null : ok}>
                          {isMain
                            ? "Main address"
                            : h.error
                              ? /domain not found/i.test(h.error)
                                ? "No DNS"
                                : "Fails"
                              : h.reachesCanonical
                                ? `Redirects${h.hops > 1 ? ` (${h.hops} hops)` : ""}`
                                : "Doesn't redirect"}
                        </Chip>
                      </div>
                    );
                  })}
                </dd>
              </div>
            )}
            <div className="px-4 py-3">
              <dt className={`text-xs ${muted}`}>Page limit</dt>
              <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{audit.pageLimit.toLocaleString("en-GB")}</dd>
            </div>
          </dl>
      <p className={`mt-3 text-xs leading-relaxed ${muted}`}>
        Pages are read as plain HTML, the way most search crawlers first see them. Links that only appear after
        JavaScript runs in the browser won&apos;t be found.
      </p>
    </section>
  );
}
