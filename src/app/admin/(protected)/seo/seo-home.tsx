"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { normaliseInputUrl } from "@/lib/seo/urls";
import { ESTIMATED_PAGES_PER_SECOND, PAGE_LIMIT, PAGE_LIMIT_OPTIONS } from "@/lib/seo/types";
import { MAX_TARGET_PHRASES, parseTargets } from "@/lib/seo/content/model";
import { removeAudit, startAudit, isActive, isContentScan, contentPrefill, useAuditStore, type AuditRecord } from "./audit-store";
import { card, muted } from "./report";
import { PhaseBadge } from "./audit-views";

/** "under a minute", "about 3 minutes", "about 14 minutes". */
function estimateDuration(pages: number): string {
  const minutes = pages / ESTIMATED_PAGES_PER_SECOND / 60;
  if (minutes < 1) return "under a minute";
  const rounded = Math.round(minutes);
  return `about ${rounded} minute${rounded === 1 ? "" : "s"}`;
}

const inputCls =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600";

export function SeoHome() {
  const router = useRouter();
  const { hydrated, audits } = useAuditStore();
  // "Change phrases" on a content scan arrives with its URL, cap and phrases.
  const [prefill] = useState(contentPrefill);
  const [input, setInput] = useState(prefill?.url ?? "");
  const [pageLimit, setPageLimit] = useState<number>(prefill?.pageLimit ?? PAGE_LIMIT);
  // Ticked by default (Ian, 2026-10-11).
  const [checkExternal, setCheckExternal] = useState(true);
  // Phase 5b — also ticked by default; untick for a quicker audit.
  const [checkSpeed, setCheckSpeed] = useState(true);
  // Phase 6 (Ian, 2026-10-13): the content scan is a separate run.
  const [mode, setMode] = useState<"audit" | "content">(prefill ? "content" : "audit");
  const [phraseText, setPhraseText] = useState(prefill?.phrases.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  const running = audits.find(isActive);

  const phraseLines = phraseText.split("\n").filter((l) => l.trim());
  const phrases = parseTargets(phraseLines).map((p) => p.text);
  const tooMany = phraseLines.length > MAX_TARGET_PHRASES;

  const start = () => {
    const url = normaliseInputUrl(input);
    if (!url) {
      setError("Enter a valid website address, e.g. https://example.com");
      return;
    }
    if (mode === "content" && tooMany) {
      setError(`Up to ${MAX_TARGET_PHRASES} target phrases per scan.`);
      return;
    }
    try {
      if (mode === "content") {
        const id = startAudit(url, { kind: "content", phrases, pageLimit, checkExternal: false, checkSpeed: false });
        router.push(`/admin/seo/content/${id}`);
      } else {
        const id = startAudit(url, { pageLimit, checkExternal, checkSpeed });
        router.push(`/admin/seo/audit/${id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mt-6">
      <div className="mb-3 inline-flex rounded-md border border-zinc-300 p-0.5 text-sm dark:border-zinc-700" role="tablist" aria-label="Kind of scan">
        {([
          ["audit", "Technical audit"],
          ["content", "Content scan"],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            disabled={!!running}
            className={`rounded px-3 py-1.5 font-medium transition-colors disabled:opacity-60 ${
              mode === m ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!running) start();
        }}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <input
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!!running}
          placeholder="https://example.com"
          aria-label="Website address to audit"
          className={`w-full sm:max-w-md ${inputCls}`}
        />
        <select
          value={pageLimit}
          onChange={(e) => setPageLimit(Number(e.target.value))}
          disabled={!!running}
          aria-label="Maximum pages to crawl"
          className={inputCls}
        >
          {PAGE_LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Up to {n.toLocaleString("en-GB")} pages
            </option>
          ))}
        </select>
        {mode === "audit" && (
        <>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 px-1 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={checkExternal}
            onChange={(e) => setCheckExternal(e.target.checked)}
            disabled={!!running}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-50"
          />
          Check external links
        </label>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 px-1 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={checkSpeed}
            onChange={(e) => setCheckSpeed(e.target.checked)}
            disabled={!!running}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-50"
          />
          Test page speed
        </label>
        </>
        )}
        <button
          type="submit"
          disabled={!!running || !hydrated}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {mode === "content" ? "Run content scan" : "Run audit"}
        </button>
        {mode === "content" && (
          <div className="w-full basis-full">
            <label htmlFor="target-phrases" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Target phrases <span className={`font-normal ${muted}`}>— optional, one per line, up to {MAX_TARGET_PHRASES}</span>
            </label>
            <textarea
              id="target-phrases"
              value={phraseText}
              onChange={(e) => setPhraseText(e.target.value)}
              disabled={!!running}
              rows={4}
              spellCheck={false}
              placeholder={"sales forecasting\nfractional CMO"}
              className={`mt-1 w-full sm:max-w-md ${inputCls}`}
            />
            <p className={`mt-1 text-xs ${tooMany ? "text-red-600 dark:text-red-400" : muted}`}>
              {tooMany
                ? `${phraseLines.length} phrases — up to ${MAX_TARGET_PHRASES} per scan.`
                : "The phrases the client wants to be found for. Each is checked against every page's title, H1, URL, description, headings and full text."}
            </p>
          </div>
        )}
      </form>
      {running ? (
        <p className="mt-3 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          {isContentScan(running) ? "A content scan" : "An audit"} of <span className="font-medium">{hostOf(running.requestedUrl)}</span> is running — one at a time.{" "}
          <Link href={`/admin/seo/${isContentScan(running) ? "content" : "audit"}/${running.id}`} className="font-medium underline underline-offset-2">
            Watch it
          </Link>
        </p>
      ) : mode === "content" ? (
        <p className={`mt-2 max-w-3xl text-xs ${muted}`}>
          Reads every page to map what the site is about: the main phrases by section, each page&apos;s focus phrase, and
          your target phrases. Quicker than the technical audit (no link checks or speed tests) — a full{" "}
          {pageLimit.toLocaleString("en-GB")}-page scan takes {estimateDuration(pageLimit)}. No search volume or rankings.
        </p>
      ) : (
        <p className={`mt-2 text-xs ${muted}`}>
          A full {pageLimit.toLocaleString("en-GB")}-page audit takes {estimateDuration(pageLimit)}; smaller sites finish
          sooner. You can move around the admin while it runs — just keep this tab open.{" "}
          {checkExternal
            ? "External links are checked as pages are crawled, which can add a couple of minutes on link-heavy sites."
            : "External links won't be checked (this site's own pages, files and images still are)."}{" "}
          {checkSpeed
            ? "Page speed is tested on a sample of pages afterwards — a few more minutes."
            : "Page speed won't be tested (you can run it later from the audit)."}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">This session&apos;s audits and scans</h2>
        <p className={`mt-1 text-xs ${muted}`}>Kept until you close this tab (the last {10}).</p>
        <div className={`mt-3 ${card}`}>
          {!hydrated ? (
            <p className={`px-4 py-6 text-center text-sm ${muted}`}>Loading…</p>
          ) : audits.length === 0 ? (
            <p className={`px-4 py-6 text-center text-sm ${muted}`}>No audits yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {audits.map((a) => (
                <AuditRow key={a.id} record={a} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function AuditRow({ record }: { record: AuditRecord }) {
  const s = record.summary;
  const pages = record.audit?.pages.length ?? 0;
  const content = isContentScan(record);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <Link href={`/admin/seo/${content ? "content" : "audit"}/${record.id}`} className="min-w-0 flex-1 basis-56">
        <span className="block truncate font-medium text-zinc-900 hover:underline dark:text-zinc-50">{hostOf(record.requestedUrl)}</span>
        <span className={`block text-xs ${muted}`}>
          {new Date(record.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ·{" "}
          {content && <span className="font-medium text-violet-700 dark:text-violet-300">Content scan · </span>}
          {(s?.pages ?? pages).toLocaleString("en-GB")} pages · up to {record.options.pageLimit.toLocaleString("en-GB")}
          {content
            ? ` · ${record.options.phrases?.length ?? 0} target phrase${record.options.phrases?.length === 1 ? "" : "s"}`
            : (!record.options.checkExternal ? " · external links not checked" : "") +
              (record.options.checkSpeed === false ? " · no page speed" : "")}
        </span>
      </Link>
      {s && content && s.counted !== false && (
        <span className={`text-xs tabular-nums ${muted}`}>
          <span className="font-medium text-amber-600 dark:text-amber-400">{s.warnings}</span> warnings ·{" "}
          <span className="font-medium text-sky-600 dark:text-sky-400">{s.notices}</span> notices
        </span>
      )}
      {s && !content && (
        <span className={`text-xs tabular-nums ${muted}`}>
          <span className="font-medium text-red-600 dark:text-red-400">{s.errors}</span> errors ·{" "}
          <span className="font-medium text-amber-600 dark:text-amber-400">{s.warnings}</span> warnings ·{" "}
          <span className="font-medium text-sky-600 dark:text-sky-400">{s.notices}</span> notices
        </span>
      )}
      <PhaseBadge phase={record.phase} />
      {!isActive(record) && (
        <button
          type="button"
          onClick={() => removeAudit(record.id)}
          className={`text-xs hover:text-zinc-900 dark:hover:text-zinc-50 ${muted}`}
          aria-label={`Remove audit of ${hostOf(record.requestedUrl)}`}
        >
          Remove
        </button>
      )}
    </li>
  );
}
