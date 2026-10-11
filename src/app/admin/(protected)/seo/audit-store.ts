"use client";

/**
 * Session audit store (phase 5a, Ian 2026-10-11: "persistence until the tab
 * is closed").
 *
 * - The crawl runs here, in a module-level singleton, not inside a page
 *   component — so moving between the overview, stage screens and the rest
 *   of the admin (client-side navigation) doesn't interrupt it.
 * - Audits are mirrored to IndexedDB under a per-tab session id kept in
 *   sessionStorage. sessionStorage survives a refresh and is cleared when
 *   the tab closes, so a refresh brings results back and closing the tab
 *   forgets them. (sessionStorage itself is too small — a 5,000-page audit
 *   is ~18 MB.) IndexedDB rows from closed tabs are deleted once their
 *   session's heartbeat is a day old.
 * - A refresh mid-crawl can't resume (the crawl lived in the old page), so
 *   an audit found "running" on load is marked stopped, with what it had.
 * - One audit runs at a time.
 *
 * Never sent anywhere: audit data stays in this browser (CLAUDE.md: never
 * write audit data to GitHub).
 */

import { useSyncExternalStore } from "react";
import { runCrawl, crawlPacing } from "@/lib/seo/crawler";
import type { LinkCheckItem } from "@/lib/seo/crawler";
import { computeFindings, summarise } from "@/lib/seo/findings";
import { pickSpeedSample } from "@/lib/seo/speed";
import type {
  AuditResult,
  DiscoveryResult,
  FetchedPage,
  FieldMetrics,
  LinkCheckResult,
  SpeedResult,
  SpeedState,
  SpeedStrategy,
} from "@/lib/seo/types";

export type AuditPhase = "discovering" | "running" | "done" | "stopped" | "error";

export interface AuditOptions {
  pageLimit: number;
  checkExternal: boolean;
  /** Phase 5b: speed-test a sample of pages after the crawl. Missing on older records = true. */
  checkSpeed?: boolean;
}

export interface AuditSummary {
  pages: number;
  brokenLinks: number;
  errors: number;
  warnings: number;
  notices: number;
}

export interface AuditRecord {
  id: string;
  session: string;
  requestedUrl: string;
  createdAt: string;
  options: AuditOptions;
  phase: AuditPhase;
  /** Discovery or session errors (crawl errors live on audit.error). */
  error: string | null;
  audit: AuditResult | null;
  queued: number;
  pacingNote: string | null;
  /** Worked out once the audit stops, for the recent-audits list. */
  summary: AuditSummary | null;
}

interface StoreState {
  hydrated: boolean;
  audits: AuditRecord[]; // newest first
}

const MAX_AUDITS = 10;
const DB_NAME = "mediasurface-seo";
const SESSION_KEY = "ms-seo-session";
const HEARTBEAT_MS = 60_000;
const STALE_SESSION_MS = 24 * 60 * 60 * 1000;
const SAVE_EVERY_MS = 5_000;

const SERVER_STATE: StoreState = { hydrated: false, audits: [] };
let state: StoreState = { hydrated: false, audits: [] };
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let hydrateStarted = false;

function emit() {
  for (const l of listeners) l();
}

function setState(next: StoreState) {
  state = next;
  emit();
}

function patch(id: string, change: Partial<AuditRecord>) {
  setState({ ...state, audits: state.audits.map((a) => (a.id === id ? { ...a, ...change } : a)) });
}

function get(id: string): AuditRecord | undefined {
  return state.audits.find((a) => a.id === id);
}

export function isActive(r: AuditRecord): boolean {
  return r.phase === "discovering" || r.phase === "running";
}

function summaryOf(audit: AuditResult | null): AuditSummary | null {
  if (!audit) return null;
  const s = summarise(audit, computeFindings(audit));
  return { pages: s.pagesCrawled, brokenLinks: s.brokenLinks, errors: s.errors, warnings: s.warnings, notices: s.notices };
}

// ------------------------------------------------------------ session id

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked: results last until the page is reloaded.
    return memorySession;
  }
}
const memorySession = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

// ------------------------------------------------------------ IndexedDB

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          const audits = d.createObjectStore("audits", { keyPath: "id" });
          audits.createIndex("session", "session");
          d.createObjectStore("sessions", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store: "audits" | "sessions", value: unknown) {
  const d = await db();
  if (!d) return;
  try {
    await done(d.transaction(store, "readwrite").objectStore(store).put(value));
  } catch {
    // Quota or private mode — results just won't survive a refresh.
  }
}

async function idbDelete(store: "audits" | "sessions", key: string) {
  const d = await db();
  if (!d) return;
  try {
    await done(d.transaction(store, "readwrite").objectStore(store).delete(key));
  } catch {
    /* best effort */
  }
}

/** Drop audits belonging to tabs that closed (heartbeat over a day old). */
async function cleanStaleSessions(current: string) {
  const d = await db();
  if (!d) return;
  try {
    const sessions = (await done(d.transaction("sessions").objectStore("sessions").getAll())) as { id: string; lastSeen: number }[];
    const stale = sessions.filter((s) => s.id !== current && Date.now() - s.lastSeen > STALE_SESSION_MS);
    for (const s of stale) {
      const keys = await done(d.transaction("audits").objectStore("audits").index("session").getAllKeys(s.id));
      for (const k of keys) await idbDelete("audits", String(k));
      await idbDelete("sessions", s.id);
    }
  } catch {
    /* best effort */
  }
}

function heartbeat() {
  void idbPut("sessions", { id: sessionId(), lastSeen: Date.now() });
}

function persistNow(id: string) {
  const t = saveTimers.get(id);
  if (t) clearTimeout(t);
  saveTimers.delete(id);
  const r = get(id);
  if (r) void idbPut("audits", r);
}

/** Throttled while an audit runs (a big audit is many MB to clone). */
function persistSoon(id: string) {
  if (saveTimers.has(id)) return;
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id);
      persistNow(id);
    }, SAVE_EVERY_MS)
  );
}

async function hydrate() {
  const session = sessionId();
  heartbeat();
  setInterval(heartbeat, HEARTBEAT_MS);
  void cleanStaleSessions(session);

  let saved: AuditRecord[] = [];
  const d = await db();
  if (d) {
    try {
      saved = (await done(d.transaction("audits").objectStore("audits").index("session").getAll(session))) as AuditRecord[];
    } catch {
      saved = [];
    }
  }
  const restored = saved.map((r): AuditRecord => {
    if (!isActive(r)) return r;
    if (r.audit?.status === "complete") {
      // Reloaded during page speed tests: the crawl itself finished.
      const speed = r.audit.speed && r.audit.speed.status === "running" ? { ...r.audit.speed, status: "cancelled" as const } : r.audit.speed;
      const audit: AuditResult = { ...r.audit, stage: "done", speed };
      const fixed: AuditRecord = {
        ...r,
        phase: "done",
        audit,
        queued: 0,
        error: speed?.status === "cancelled" ? "The page was reloaded during the page speed tests, so they stopped early. Run them again from the Page speed stage." : r.error,
        summary: summaryOf(audit),
      };
      void idbPut("audits", fixed);
      return fixed;
    }
    // The page that was running this audit is gone.
    const audit = r.audit ? { ...r.audit, status: "cancelled" as const, finishedAt: r.audit.finishedAt ?? new Date().toISOString() } : null;
    const fixed: AuditRecord = {
      ...r,
      phase: "stopped",
      audit,
      queued: 0,
      error: "The page was reloaded while this audit was running, so it stopped. Results cover what was crawled before then.",
      summary: summaryOf(audit),
    };
    void idbPut("audits", fixed);
    return fixed;
  });
  // Anything started before hydration finished (unlikely) stays on top.
  const ids = new Set(state.audits.map((a) => a.id));
  const audits = [...state.audits, ...restored.filter((r) => !ids.has(r.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  setState({ hydrated: true, audits });
}

function ensureHydrated() {
  if (hydrateStarted || typeof window === "undefined") return;
  hydrateStarted = true;
  window.addEventListener("beforeunload", (e) => {
    if (state.audits.some(isActive)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  void hydrate();
}

// ------------------------------------------------------------ React hooks

function subscribe(l: () => void) {
  ensureHydrated();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAuditStore(): StoreState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

export function useAuditRecord(id: string): { hydrated: boolean; record: AuditRecord | undefined } {
  const s = useAuditStore();
  return { hydrated: s.hydrated, record: s.audits.find((a) => a.id === id) };
}

// ------------------------------------------------------------ actions

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

export function activeAudit(): AuditRecord | undefined {
  return state.audits.find(isActive);
}

/**
 * Start an audit (url already normalised). Returns its id straight away;
 * the crawl carries on in the background. Throws if one is already running.
 */
export function startAudit(url: string, options: AuditOptions): string {
  if (activeAudit()) throw new Error("An audit is already running. Stop it first, or wait for it to finish.");
  const id = crypto.randomUUID();
  const record: AuditRecord = {
    id,
    session: sessionId(),
    requestedUrl: url,
    createdAt: new Date().toISOString(),
    options,
    phase: "discovering",
    error: null,
    audit: null,
    queued: 0,
    pacingNote: null,
    summary: null,
  };
  // Keep the list short: drop the oldest finished audits.
  let audits = [record, ...state.audits];
  while (audits.length > MAX_AUDITS) {
    const oldest = [...audits].reverse().find((a) => !isActive(a));
    if (!oldest) break;
    audits = audits.filter((a) => a !== oldest);
    void idbDelete("audits", oldest.id);
  }
  setState({ ...state, audits });
  persistNow(id);
  void run(id, url, options);
  return id;
}

async function run(id: string, url: string, options: AuditOptions) {
  const controller = new AbortController();
  controllers.set(id, controller);
  const finish = (change: Partial<AuditRecord>) => {
    controllers.delete(id);
    patch(id, { queued: 0, ...change });
    persistNow(id);
  };

  let discovery: DiscoveryResult;
  try {
    discovery = await postJson<DiscoveryResult>("/api/seo/discover", { url }, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) finish({ phase: "stopped", error: "Stopped before the crawl started." });
    else finish({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (controller.signal.aborted) {
    finish({ phase: "stopped", error: "Stopped before the crawl started." });
    return;
  }

  const pacing = crawlPacing(discovery);
  const pacingNote =
    pacing.batchSize === 1
      ? `This site's robots.txt asks crawlers to wait ${discovery.robots.crawlDelay}s between requests` +
        (pacing.delayMs / 1000 < (discovery.robots.crawlDelay ?? 0) ? ` (capped at ${pacing.delayMs / 1000}s)` : "") +
        ", so the audit runs one page at a time."
      : null;
  patch(id, { phase: "running", pacingNote });

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

  let result: AuditResult;
  try {
    result = await runCrawl({
      requestedUrl: url,
      discovery,
      fetchBatch,
      checkBatch,
      checkExternal: options.checkExternal,
      pageLimit: options.pageLimit,
      signal: controller.signal,
      onProgress: (snapshot, queued) => {
        patch(id, { audit: snapshot, queued });
        persistSoon(id);
      },
    });
  } catch (err) {
    finish({ phase: "error", error: err instanceof Error ? err.message : String(err), summary: summaryOf(get(id)?.audit ?? null) });
    return;
  }
  const phase: AuditPhase = result.status === "cancelled" ? "stopped" : result.status === "error" ? "error" : "done";
  if (phase !== "done") {
    finish({ phase, audit: result, summary: summaryOf(result) });
    return;
  }
  if (options.checkSpeed === false) {
    finish({ phase, audit: { ...result, speed: emptySpeed("skipped") }, summary: summaryOf(result) });
    return;
  }
  patch(id, { audit: result, queued: 0 });
  await runSpeed(id, controller.signal);
  finish({ phase: "done", summary: summaryOf(get(id)?.audit ?? result) });
}

// ------------------------------------------------------------ page speed (5b)

/** Lighthouse runs in flight at once. Each takes 10–25s on Google's side. */
const SPEED_CONCURRENCY = 4;

function emptySpeed(status: SpeedState["status"]): SpeedState {
  return { status, indexablePages: 0, sample: [], results: [], field: null, diagnoses: {}, error: null };
}

/** Replace the audit's speed state (immutably) and save soon. */
function updateSpeed(id: string, change: (s: SpeedState) => SpeedState, audit?: Partial<AuditResult>) {
  const r = get(id);
  if (!r?.audit) return;
  const speed = change(r.audit.speed ?? emptySpeed("pending"));
  patch(id, { audit: { ...r.audit, ...audit, speed } });
  persistSoon(id);
}

async function speedRequest(url: string, strategy: SpeedStrategy, diagnose: boolean, signal?: AbortSignal): Promise<SpeedResult> {
  const { result } = await postJson<{ result: SpeedResult }>("/api/seo/speed", { url, strategy, diagnose }, signal);
  return result;
}

/** One retry for transient failures (Lighthouse occasionally fails a page). */
async function speedWithRetry(url: string, strategy: SpeedStrategy, diagnose: boolean, signal?: AbortSignal): Promise<SpeedResult> {
  const first = await speedRequest(url, strategy, diagnose, signal);
  if (first.score !== null || /quota/i.test(first.error ?? "") || signal?.aborted) return first;
  await new Promise((r) => setTimeout(r, 2000));
  return speedRequest(url, strategy, diagnose, signal);
}

async function runSpeed(id: string, signal: AbortSignal) {
  const audit = get(id)?.audit;
  if (!audit) return;
  const { indexablePages, sample } = pickSpeedSample(audit);
  const diagnoses = audit.speed?.diagnoses ?? {};
  updateSpeed(id, () => ({ ...emptySpeed("running"), indexablePages, sample, diagnoses }), { stage: "testing-speed" });

  const field = postJson<{ found: boolean; phone: FieldMetrics | null; desktop: FieldMetrics | null; error: string | null }>(
    "/api/seo/field",
    { origin: audit.discovery.origin },
    signal
  )
    .then((f) => updateSpeed(id, (s) => ({ ...s, field: { found: f.found, phone: f.phone, desktop: f.desktop, error: f.error } })))
    .catch((err) => {
      if (!signal.aborted) updateSpeed(id, (s) => ({ ...s, field: { found: false, phone: null, desktop: null, error: err instanceof Error ? err.message : String(err) } }));
    });

  let fatal: string | null = null;
  const queue = sample.map((e) => e.url);
  const worker = async () => {
    while (queue.length && !signal.aborted && !fatal) {
      const url = queue.shift()!;
      try {
        const result = await speedWithRetry(url, "mobile", false, signal);
        updateSpeed(id, (s) => ({ ...s, results: [...s.results, result] }));
      } catch (err) {
        if (signal.aborted) return;
        // Config problems (no API key) and expired sessions stop the run.
        fatal = err instanceof Error ? err.message : String(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SPEED_CONCURRENCY, queue.length) }, worker));
  await field;
  updateSpeed(
    id,
    (s) => ({ ...s, status: signal.aborted ? "cancelled" : fatal ? "error" : "complete", error: fatal }),
    { stage: "done" }
  );
  persistNow(id);
}

/** Run (or re-run) the page speed tests on a finished audit. */
export function startSpeed(id: string) {
  const r = get(id);
  if (!r?.audit || r.audit.status !== "complete") throw new Error("Page speed needs a finished crawl.");
  if (activeAudit()) throw new Error("Another audit is running. Wait for it to finish first.");
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(id, { phase: "running", error: null });
  void runSpeed(id, controller.signal).then(() => {
    controllers.delete(id);
    patch(id, { phase: "done", summary: summaryOf(get(id)?.audit ?? null) });
    persistNow(id);
  });
}

/** Full mobile + desktop Lighthouse runs for one page, with what to fix. */
export function runDiagnosis(id: string, url: string) {
  const r = get(id);
  if (!r?.audit) return;
  if (r.audit.speed?.diagnoses[url]?.status === "running") return;
  const set = (d: Partial<NonNullable<SpeedState["diagnoses"][string]>>) =>
    updateSpeed(id, (s) => ({
      ...s,
      diagnoses: {
        ...s.diagnoses,
        [url]: { ...(s.diagnoses[url] ?? { status: "running", mobile: null, desktop: null, error: null }), ...d },
      },
    }));
  set({ status: "running", error: null });
  Promise.all([speedWithRetry(url, "mobile", true), speedWithRetry(url, "desktop", true)])
    .then(([mobile, desktop]) => {
      set({ status: "done", mobile, desktop });
      persistNow(id);
    })
    .catch((err) => set({ status: "error", error: err instanceof Error ? err.message : String(err) }));
}

export function stopAudit(id: string) {
  controllers.get(id)?.abort();
}

export function removeAudit(id: string) {
  if (get(id) && isActive(get(id)!)) stopAudit(id);
  const t = saveTimers.get(id);
  if (t) clearTimeout(t);
  saveTimers.delete(id);
  setState({ ...state, audits: state.audits.filter((a) => a.id !== id) });
  void idbDelete("audits", id);
}
