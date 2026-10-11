/**
 * Phase 3: status-only link checks. Server-only.
 *
 * Used for external links and same-site files/images — targets the crawler
 * doesn't fetch as pages. Nothing but the status comes back to the browser,
 * so this route can safely accept off-site URLs (the SSRF guard in
 * safeFetch still applies to every hop).
 *
 * Verdicts — "broken" must mean broken, because these reports can go to
 * clients. Anything ambiguous is "unverified", listed separately:
 * - ok:         2xx, including after redirects
 * - broken:     404 / 410, domain not found, connection refused, TLS
 *               certificate errors, redirect loops, 500 / 502 / 504 on two
 *               attempts
 * - unverified: 401 / 403 / 429 / 503 / 999 (LinkedIn's bot response),
 *               Cloudflare 52x, other 4xx, timeouts, resets — usually
 *               bot-blocking, login walls or blips, not dead links
 *
 * HEAD first (no body); fall back to GET whenever HEAD isn't a clean 2xx,
 * because plenty of servers answer HEAD wrongly (405, 404, 403) while GET
 * works. GET bodies are never read.
 */

import "server-only";
import { safeFetch, type RawFetchResult } from "./fetch-page";
import type { LinkCheckResult, LinkVerdict } from "./types";

const CHECK_TIMEOUT_MS = 8_000;

function ok(r: RawFetchResult): boolean {
  return !r.error && r.status >= 200 && r.status < 300;
}

function request(url: string, method: "GET" | "HEAD"): Promise<RawFetchResult> {
  return safeFetch(url, {
    method,
    timeoutMs: CHECK_TIMEOUT_MS,
    wantBody: () => false,
    accept: "*/*",
  });
}

function classify(r: RawFetchResult): { verdict: LinkVerdict; reason: string } {
  if (r.error) {
    switch (r.errorKind) {
      case "dns":
        return { verdict: "broken", reason: "Domain not found" };
      case "refused":
        return { verdict: "broken", reason: "Connection refused" };
      case "tls":
        return { verdict: "broken", reason: "Certificate error" };
      case "redirects":
        return { verdict: "broken", reason: "Redirect loop" };
      case "guard":
        return { verdict: "broken", reason: "Points at a private address" };
      case "timeout":
        return { verdict: "unverified", reason: "Timed out" };
      default:
        return { verdict: "unverified", reason: r.error };
    }
  }
  const s = r.status;
  if (s >= 200 && s < 300) return { verdict: "ok", reason: `HTTP ${s}` };
  if (s === 404 || s === 410) return { verdict: "broken", reason: `HTTP ${s}` };
  // Order matters: these bot-protection codes are >= 500 but aren't server
  // failures. Found 2026-10-11 — LinkedIn's 999 was first misreported as a
  // "server error", and McKinsey answers bots with 503 (its homepage resets
  // the connection for any automated client).
  if (s === 999 || s === 403) return { verdict: "unverified", reason: `Blocked our checker (${s})` };
  if (s === 503) return { verdict: "unverified", reason: "Unavailable (503) — often bot protection" };
  if (s >= 520 && s <= 530) return { verdict: "unverified", reason: `Cloudflare error (${s})` };
  if (s === 500 || s === 502 || s === 504) return { verdict: "broken", reason: `Server error (HTTP ${s})` };
  if (s === 401) return { verdict: "unverified", reason: "Needs login (401)" };
  if (s === 429) return { verdict: "unverified", reason: "Rate-limited (429)" };
  return { verdict: "unverified", reason: `HTTP ${s}` };
}

export async function checkLink(url: string, kind: LinkCheckResult["kind"]): Promise<LinkCheckResult> {
  let r = await request(url, "HEAD");
  if (!ok(r) && r.errorKind !== "dns" && r.errorKind !== "guard" && r.errorKind !== "invalid") {
    r = await request(url, "GET");
    // One retry for server errors and resets — often transient.
    if (!r.error && (r.status === 500 || r.status === 502 || r.status === 504)) {
      await new Promise((res) => setTimeout(res, 1000));
      r = await request(url, "GET");
    } else if (r.errorKind === "reset") {
      r = await request(url, "GET");
    }
  }
  const { verdict, reason } = classify(r);
  const len = Number(r.headers["content-length"]);
  return {
    url,
    kind,
    status: r.status,
    finalUrl: r.finalUrl,
    verdict,
    reason,
    // Sizes/caching only matter for the site's own files (image weight check).
    ...(kind === "asset"
      ? {
          contentLength: Number.isFinite(len) && len > 0 ? len : null,
          contentType: r.headers["content-type"] ?? null,
          cacheControl: r.headers["cache-control"] ?? (r.headers["expires"] ? `expires ${r.headers["expires"]}` : null),
        }
      : {}),
  };
}

/**
 * Check many URLs with an overall concurrency limit and at most
 * `perHost` requests in flight to any one host, so a page full of links to
 * one site doesn't hammer it.
 *
 * No new check starts after `startDeadlineMs`; those come back as null and
 * the browser re-queues them. One check can take up to ~25s (HEAD + two
 * GETs at 8s), so a 25s start deadline keeps the request under the
 * route's 60s maxDuration even when one host is slow.
 */
export async function checkLinks(
  items: { url: string; kind: LinkCheckResult["kind"] }[],
  { concurrency = 8, perHost = 2, startDeadlineMs = 25_000 } = {}
): Promise<(LinkCheckResult | null)[]> {
  const results: (LinkCheckResult | null)[] = new Array(items.length).fill(null);
  const deadline = Date.now() + startDeadlineMs;
  const active = new Map<string, number>();
  const pending = items.map((item, i) => ({ ...item, i, host: hostOf(item.url) }));
  let running = 0;

  return new Promise((resolve) => {
    const launch = () => {
      const pastDeadline = Date.now() >= deadline;
      if ((pending.length === 0 || pastDeadline) && running === 0) return resolve(results);
      if (pastDeadline) return;
      for (let j = 0; j < pending.length && running < concurrency; ) {
        const next = pending[j];
        if ((active.get(next.host) ?? 0) >= perHost) {
          j++;
          continue;
        }
        pending.splice(j, 1);
        running++;
        active.set(next.host, (active.get(next.host) ?? 0) + 1);
        checkLink(next.url, next.kind).then((res) => {
          results[next.i] = res;
          running--;
          active.set(next.host, (active.get(next.host) ?? 1) - 1);
          launch();
        });
      }
    };
    launch();
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}
