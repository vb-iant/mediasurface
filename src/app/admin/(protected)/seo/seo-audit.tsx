"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { runCrawl, crawlPacing } from "@/lib/seo/crawler";
import { normaliseInputUrl } from "@/lib/seo/urls";
import type { AuditResult, DiscoveryResult, FetchedPage, LinkCheckResult } from "@/lib/seo/types";
import type { LinkCheckItem } from "@/lib/seo/crawler";
import { ESTIMATED_PAGES_PER_SECOND, PAGE_LIMIT, PAGE_LIMIT_OPTIONS } from "@/lib/seo/types";
import { AuditReport } from "./report";

type Phase = "idle" | "discovering" | "crawling" | "done";

/** "under a minute", "about 3 minutes", "about 14 minutes". */
function estimateDuration(pages: number): string {
  const minutes = pages / ESTIMATED_PAGES_PER_SECOND / 60;
  if (minutes < 1) return "under a minute";
  const rounded = Math.round(minutes);
  return `about ${rounded} minute${rounded === 1 ? "" : "s"}`;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    throw new Error("Your admin session has expired. Log in again, then re-run the audit.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) {
    throw new Error(data?.error ?? `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

export function SeoAudit() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [queued, setQueued] = useState(0);
  const [pacingNote, setPacingNote] = useState<string | null>(null);
  const [pageLimit, setPageLimit] = useState<number>(PAGE_LIMIT);
  // Ticked by default (Ian, 2026-10-11): every audit is complete unless
  // someone deliberately chooses a quick one.
  const [checkExternal, setCheckExternal] = useState(true);
  /** The limit the current/last audit actually ran with. */
  const [activeLimit, setActiveLimit] = useState<number>(PAGE_LIMIT);
  const controllerRef = useRef<AbortController | null>(null);

  const running = phase === "discovering" || phase === "crawling";
  // The report recomputes findings from the whole audit on every batch
  // (~80ms at 5,000 pages). Rendering it from a deferred copy lets React
  // treat that as low-priority work, so the progress bar, Stop button and
  // scrolling stay responsive during a big crawl.
  const reportAudit = useDeferredValue(audit);

  // Results only live in this tab, so warn before closing it mid-audit.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const start = useCallback(async () => {
    const url = normaliseInputUrl(input);
    if (!url) {
      setError("Enter a valid website address, e.g. https://example.com");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setAudit(null);
    setQueued(0);
    setPacingNote(null);
    setActiveLimit(pageLimit);
    setPhase("discovering");

    let discovery: DiscoveryResult;
    try {
      discovery = await postJson<DiscoveryResult>("/api/seo/discover", { url }, controller.signal);
    } catch (err) {
      setPhase("idle");
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (controller.signal.aborted) {
      setPhase("idle");
      return;
    }

    const pacing = crawlPacing(discovery);
    if (pacing.batchSize === 1) {
      setPacingNote(
        `This site's robots.txt asks crawlers to wait ${discovery.robots.crawlDelay}s between requests` +
          (pacing.delayMs / 1000 < (discovery.robots.crawlDelay ?? 0) ? ` (capped at ${pacing.delayMs / 1000}s)` : "") +
          ", so the audit will run one page at a time."
      );
    }

    setPhase("crawling");
    const fetchBatch = async (origin: string, urls: string[]) => {
      const data = await postJson<{ pages: FetchedPage[] }>("/api/seo/fetch", { origin, urls }, controller.signal);
      return data.pages;
    };
    const checkBatch = async (items: LinkCheckItem[], opts?: { perHost?: number }) => {
      const data = await postJson<{ results: (LinkCheckResult | null)[] }>(
        "/api/seo/check",
        { items, perHost: opts?.perHost },
        controller.signal
      );
      return data.results;
    };

    const result = await runCrawl({
      requestedUrl: url,
      discovery,
      fetchBatch,
      checkBatch,
      checkExternal,
      pageLimit,
      signal: controller.signal,
      onProgress: (snapshot, q) => {
        setAudit(snapshot);
        setQueued(q);
      },
    });
    setAudit(result);
    setQueued(0);
    setPhase("done");
    controllerRef.current = null;
  }, [input, pageLimit, checkExternal]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const fetched = audit?.pages.length ?? 0;
  const expected = Math.min(activeLimit, fetched + queued);
  const linkCheck = audit?.linkCheck;
  const stage = audit?.stage ?? "crawling";
  const afterCrawl = running && (stage === "checking-links" || stage === "rechecking");
  const checked = linkCheck?.results.length ?? 0;
  const linksTotal = linkCheck?.total ?? 0;
  // Links are checked during the crawl now, so the bar follows the crawl
  // until it ends, then follows whatever link checks are left.
  const pct = afterCrawl
    ? Math.round((checked / Math.max(1, linksTotal)) * 100)
    : expected > 0
      ? Math.round((fetched / expected) * 100)
      : 0;

  return (
    <div className="mt-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!running) void start();
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
          disabled={running}
          placeholder="https://example.com"
          aria-label="Website address to audit"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none disabled:opacity-60 sm:max-w-md dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600"
        />
        <select
          value={pageLimit}
          onChange={(e) => setPageLimit(Number(e.target.value))}
          disabled={running}
          aria-label="Maximum pages to crawl"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        >
          {PAGE_LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Up to {n.toLocaleString("en-GB")} pages
            </option>
          ))}
        </select>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 px-1 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={checkExternal}
            onChange={(e) => setCheckExternal(e.target.checked)}
            disabled={running}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-50"
          />
          Check external links
        </label>
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Run audit
          </button>
        )}
      </form>
      {!running && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          A full {pageLimit.toLocaleString("en-GB")}-page audit takes {estimateDuration(pageLimit)}
          {pageLimit > PAGE_LIMIT ? " — keep this tab open until it finishes, results aren't saved." : "."}{" "}
          Smaller sites finish sooner.{" "}
          {checkExternal
            ? "External links are checked as pages are crawled, which can add a couple of minutes on link-heavy sites."
            : "External links won't be checked (this site's own pages, files and images still are)."}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {running && (
        <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {phase === "discovering"
                ? "Reading robots.txt and sitemaps…"
                : stage === "rechecking"
                  ? "Rechecking pages that failed…"
                  : stage === "checking-links"
                    ? "Finishing link, file and image checks…"
                    : "Crawling pages…"}
            </span>
            {phase === "crawling" && (
              <span className="text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                {afterCrawl
                  ? `${fetched} pages crawled`
                  : `${fetched} fetched · ${queued} queued · limit ${activeLimit.toLocaleString("en-GB")}`}
                {linksTotal > 0 && ` · ${checked.toLocaleString("en-GB")} of ${linksTotal.toLocaleString("en-GB")} links checked`}
              </span>
            )}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-50 ${phase === "discovering" ? "w-1/12 animate-pulse" : ""}`}
              style={phase === "crawling" ? { width: `${Math.max(2, pct)}%` } : undefined}
            />
          </div>
          {pacingNote && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{pacingNote}</p>}
        </div>
      )}

      {reportAudit && <AuditReport audit={reportAudit} live={running} />}
    </div>
  );
}
