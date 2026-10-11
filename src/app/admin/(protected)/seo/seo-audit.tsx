"use client";

import { useCallback, useRef, useState } from "react";
import { runCrawl, crawlPacing } from "@/lib/seo/crawler";
import { normaliseInputUrl } from "@/lib/seo/urls";
import type { AuditResult, DiscoveryResult, FetchedPage } from "@/lib/seo/types";
import { PAGE_LIMIT } from "@/lib/seo/types";
import { AuditReport } from "./report";

type Phase = "idle" | "discovering" | "crawling" | "done";

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
  const controllerRef = useRef<AbortController | null>(null);

  const running = phase === "discovering" || phase === "crawling";

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

    const result = await runCrawl({
      requestedUrl: url,
      discovery,
      fetchBatch,
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
  }, [input]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const fetched = audit?.pages.length ?? 0;
  const expected = Math.min(PAGE_LIMIT, fetched + queued);
  const pct = expected > 0 ? Math.round((fetched / expected) * 100) : 0;

  return (
    <div className="mt-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!running) void start();
        }}
        className="flex flex-col gap-2 sm:flex-row"
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

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {running && (
        <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {phase === "discovering" ? "Reading robots.txt and sitemaps…" : "Crawling pages…"}
            </span>
            {phase === "crawling" && (
              <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                {fetched} fetched · {queued} queued · limit {PAGE_LIMIT}
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

      {audit && <AuditReport audit={audit} live={running} />}
    </div>
  );
}
