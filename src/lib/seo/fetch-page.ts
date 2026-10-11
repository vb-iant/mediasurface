/**
 * Server-only safe fetcher for the SEO audit.
 *
 * The audit fetches arbitrary URLs typed into the admin (including client
 * sites), so this is a classic SSRF surface. Guards:
 *
 * - http/https only, checked on the first request and every redirect hop.
 * - Every address a hostname resolves to is checked against private,
 *   loopback, link-local (incl. the 169.254.169.254 metadata endpoint),
 *   CGNAT, multicast and reserved ranges. The check runs inside the
 *   connection's own DNS lookup (undici `connect.lookup`), so the address
 *   that's validated is the address that's connected to — a hostname that
 *   resolves safely once and privately the next time (DNS rebinding) is
 *   still caught. IP-literal hostnames skip DNS, so they're checked up front.
 * - Redirects followed manually (max 10), each hop re-validated.
 * - Hard overall deadline per URL, and a cap on bytes read from the body.
 *
 * Never import this from a client component.
 */

import "server-only";
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { USER_AGENT, type RedirectHop } from "./types";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True if this IP must never be fetched. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) — check the embedded IPv4 address.
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP at all — refuse rather than guess
}

class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`Refused to fetch ${host}: it resolves to a private or reserved address.`);
    this.name = "BlockedAddressError";
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number,
  callback: LookupCallback
): void {
  const opts = typeof options === "number" ? { family: options } : options ?? {};
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err, opts.all ? [] : "");
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new BlockedAddressError(hostname), opts.all ? [] : "");
    }
    if (opts.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 8_000 },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
  connections: 16,
});

export interface RawFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  redirectChain: RedirectHop[];
  contentType: string | null;
  headers: Record<string, string>;
  timeMs: number;
  body: Buffer;
  truncated: boolean;
  error: string | null;
  /** Category of `error`, for callers that classify failures (link checks). */
  errorKind: FetchErrorKind | null;
}

export type FetchErrorKind = "dns" | "refused" | "timeout" | "tls" | "reset" | "guard" | "invalid" | "redirects" | "other";

export interface FetchOptions {
  /** Max bytes to read from the final response body. */
  maxBytes?: number;
  /** Overall deadline across all redirect hops, in ms. */
  timeoutMs?: number;
  /**
   * Decide from the final response's content-type whether the body is worth
   * reading at all. Return false to skip it (e.g. a PDF when we only want HTML).
   */
  wantBody?: (contentType: string | null) => boolean;
  accept?: string;
  /** HEAD for status-only link checks; GET (default) otherwise. */
  method?: "GET" | "HEAD";
}

const MAX_REDIRECTS = 10;

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function describeError(err: unknown): { message: string; kind: FetchErrorKind } {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof BlockedAddressError) return { message: cause.message, kind: "guard" };
    if (err instanceof BlockedAddressError) return { message: err.message, kind: "guard" };
    if (err.name === "TimeoutError" || err.name === "AbortError") return { message: "Timed out", kind: "timeout" };
    if (cause instanceof Error) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND") return { message: "DNS lookup failed (domain not found)", kind: "dns" };
      if (code === "ECONNREFUSED") return { message: "Connection refused", kind: "refused" };
      if (code === "ECONNRESET") return { message: "Connection reset", kind: "reset" };
      if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "ETIMEDOUT") {
        return { message: "Timed out", kind: "timeout" };
      }
      if ((code && code.startsWith("ERR_TLS")) || (code && TLS_CODES.has(code))) {
        return { message: `TLS/certificate error (${code})`, kind: "tls" };
      }
      return { message: cause.message || err.message, kind: "other" };
    }
    return { message: err.message, kind: "other" };
  }
  return { message: String(err), kind: "other" };
}

export async function safeFetch(url: string, options: FetchOptions = {}): Promise<RawFetchResult> {
  const {
    maxBytes = 5 * 1024 * 1024,
    timeoutMs = 15_000,
    wantBody = () => true,
    accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    method = "GET",
  } = options;

  const started = Date.now();
  const chain: RedirectHop[] = [];
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;

  const fail = (error: string, kind: FetchErrorKind, status = 0): RawFetchResult => ({
    url,
    finalUrl: current,
    status,
    redirectChain: chain,
    contentType: null,
    headers: {},
    timeMs: Date.now() - started,
    body: Buffer.alloc(0),
    truncated: false,
    error,
    errorKind: kind,
  });

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return fail(`Invalid URL: ${current}`, "invalid");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return fail(`Refused non-HTTP URL: ${parsed.protocol}`, "invalid");
      }
      // IP literals never go through DNS, so the lookup guard won't see them.
      const literal = parsed.hostname.replace(/^\[|\]$/g, "");
      if (isIP(literal) && isBlockedAddress(literal)) {
        return fail(new BlockedAddressError(parsed.hostname).message, "guard");
      }

      const res = await undiciFetch(current, {
        method,
        redirect: "manual",
        dispatcher: agent,
        signal,
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "en" },
      });

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        chain.push({ url: current, status: res.status });
        await res.body?.cancel().catch(() => {});
        current = new URL(location, current).toString();
        continue;
      }

      const contentType = res.headers.get("content-type");
      const headers: Record<string, string> = {};
      for (const name of [
        "x-robots-tag",
        "content-type",
        "content-length",
        "last-modified",
        "content-encoding",
        "cache-control",
        "expires",
        "strict-transport-security",
      ]) {
        const v = res.headers.get(name);
        if (v) headers[name] = v;
      }

      let body = Buffer.alloc(0);
      let truncated = false;
      if (res.body && wantBody(contentType)) {
        const chunks: Buffer[] = [];
        let total = 0;
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            chunks.push(Buffer.from(value.subarray(0, value.byteLength - (total - maxBytes))));
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(Buffer.from(value));
        }
        body = Buffer.concat(chunks);
      } else {
        await res.body?.cancel().catch(() => {});
      }

      return {
        url,
        finalUrl: current,
        status: res.status,
        redirectChain: chain,
        contentType,
        headers,
        timeMs: Date.now() - started,
        body,
        truncated,
        error: null,
        errorKind: null,
      };
    }
    return fail(`Too many redirects (more than ${MAX_REDIRECTS})`, "redirects");
  } catch (err) {
    const { message, kind } = describeError(err);
    return fail(message, kind);
  }
}
