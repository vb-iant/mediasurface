/**
 * URL helpers shared by the crawler (client) and the fetch routes (server).
 * Pure functions, no Node APIs.
 */

/** Strip a leading "www." so www and apex count as the same site. */
export function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** siteHost() of a URL, memoised for the same reason as urlKey() below. */
const hostCache = new Map<string, string | null>();

function siteHostOf(url: string): string | null {
  const cached = hostCache.get(url);
  if (cached !== undefined) return cached;
  let host: string | null;
  try {
    host = siteHost(new URL(url).hostname);
  } catch {
    host = null;
  }
  if (hostCache.size >= 100_000) hostCache.clear();
  hostCache.set(url, host);
  return host;
}

export function isSameSite(url: string, origin: string): boolean {
  const a = siteHostOf(url);
  return a !== null && a === siteHostOf(origin);
}

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

/**
 * Canonical key used to de-duplicate URLs during a crawl.
 *
 * - drops the fragment
 * - treats www and apex as the same host, and http/https as the same page
 * - treats /foo and /foo/ as the same page
 * - drops common tracking parameters, keeps everything else
 *
 * This is only a de-dupe key. The URL actually fetched and shown in the
 * report is always the real one we found.
 *
 * Memoised: the same nav/footer links appear on every page, and the report
 * recomputes findings after every batch, so without a cache a 5,000-page
 * audit re-parses hundreds of thousands of identical URLs each time.
 */
const keyCache = new Map<string, string>();
const KEY_CACHE_MAX = 100_000;

export function urlKey(url: string): string {
  const cached = keyCache.get(url);
  if (cached !== undefined) return cached;
  const key = computeUrlKey(url);
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  keyCache.set(url, key);
  return key;
}

function computeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    for (const name of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(name)) u.searchParams.delete(name);
    }
    let path = u.pathname.replace(/\/{2,}/g, "/");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const query = u.searchParams.toString();
    return `${siteHost(u.hostname)}${u.port ? `:${u.port}` : ""}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

/** File types we never crawl as pages (they can still be link targets later). */
const NON_PAGE_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "gif", "svg", "webp", "avif", "ico", "bmp", "tif", "tiff",
  "mp4", "mov", "webm", "avi", "mp3", "wav", "ogg", "m4a",
  "zip", "gz", "tar", "rar", "7z", "dmg", "exe",
  "css", "js", "json", "xml", "txt", "rss", "atom",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv",
  "woff", "woff2", "ttf", "otf", "eot",
]);

export function looksLikePage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const last = pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    if (dot === -1) return true;
    return !NON_PAGE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Normalise what someone types into the search box into a fetchable URL.
 * "example.com" → "https://example.com/". Returns null if it isn't usable.
 */
export function normaliseInputUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
