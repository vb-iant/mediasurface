/**
 * Discovery: resolve the start URL, read robots.txt, read sitemaps.
 * Server-only.
 */

import "server-only";
import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { safeFetch } from "./fetch-page";
import { parseRobots } from "./robots";
import { isSameSite, urlKey } from "./urls";
import type { DiscoveryResult, RobotsInfo, SitemapInfo } from "./types";

const MAX_SITEMAP_FILES = 50;
const MAX_SITEMAP_URLS = 5000;
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;

export class DiscoveryError extends Error {}

async function readRobots(origin: string): Promise<RobotsInfo> {
  const url = new URL("/robots.txt", origin).toString();
  const res = await safeFetch(url, { accept: "text/plain,*/*;q=0.5", maxBytes: 512 * 1024 });

  const empty: RobotsInfo = {
    url,
    found: false,
    status: res.status,
    sitemaps: [],
    rules: [],
    crawlDelay: null,
    error: res.error,
  };
  if (res.error || res.status !== 200) {
    // RFC 9309: a 4xx robots.txt means no restrictions. 5xx / network errors
    // are recorded so the report can say robots.txt couldn't be read.
    if (!res.error && res.status >= 500) empty.error = `robots.txt returned ${res.status}`;
    return empty;
  }
  // Some sites serve an HTML page (soft 404) at /robots.txt.
  const text = res.body.toString("utf8");
  if (/^\s*</.test(text)) {
    return { ...empty, status: res.status, error: "robots.txt returned HTML, not a robots file" };
  }

  const parsed = parseRobots(text);
  return {
    url,
    found: true,
    status: res.status,
    sitemaps: parsed.sitemaps,
    rules: parsed.rules,
    crawlDelay: parsed.crawlDelay,
    error: null,
  };
}

function decodeSitemapBody(body: Buffer): string {
  // .xml.gz files usually arrive as raw gzip (not Content-Encoding), so
  // sniff the gzip magic bytes rather than trusting the filename.
  if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
    return gunzipSync(body, { maxOutputLength: 50 * 1024 * 1024 }).toString("utf8");
  }
  return body.toString("utf8");
}

async function readSitemaps(origin: string, declared: string[]): Promise<SitemapInfo> {
  const info: SitemapInfo = {
    found: false,
    sources: [],
    urls: [],
    truncated: false,
    offSiteCount: 0,
    errors: [],
  };

  const queue =
    declared.length > 0
      ? [...declared]
      : [new URL("/sitemap.xml", origin).toString(), new URL("/sitemap_index.xml", origin).toString()];
  const usingFallbacks = declared.length === 0;
  const seenFiles = new Set<string>();
  const seenUrls = new Set<string>();

  while (queue.length > 0) {
    if (info.sources.length >= MAX_SITEMAP_FILES) {
      info.truncated = true;
      break;
    }
    const sitemapUrl = queue.shift()!;
    if (seenFiles.has(sitemapUrl)) continue;
    seenFiles.add(sitemapUrl);

    const res = await safeFetch(sitemapUrl, {
      accept: "application/xml,text/xml,*/*;q=0.5",
      maxBytes: MAX_SITEMAP_BYTES,
    });
    if (res.error || res.status !== 200) {
      // Missing fallback guesses aren't errors — the site just doesn't have one there.
      if (!usingFallbacks || info.found) {
        info.errors.push(`${sitemapUrl}: ${res.error ?? `HTTP ${res.status}`}`);
      }
      continue;
    }

    let xml: string;
    try {
      xml = decodeSitemapBody(res.body);
    } catch {
      info.errors.push(`${sitemapUrl}: could not decompress`);
      continue;
    }
    const $ = cheerio.load(xml, { xml: true });
    const childSitemaps = $("sitemapindex > sitemap > loc");
    const pageLocs = $("urlset > url > loc");
    if (childSitemaps.length === 0 && pageLocs.length === 0) {
      if (!usingFallbacks || info.found) info.errors.push(`${sitemapUrl}: not a valid sitemap`);
      continue;
    }

    info.found = true;
    info.sources.push(sitemapUrl);
    // Once one fallback sitemap works, don't also try the other guess.
    if (usingFallbacks) queue.length = 0;

    childSitemaps.each((_, el) => {
      const loc = $(el).text().trim();
      if (loc) queue.push(loc);
    });

    pageLocs.each((_, el) => {
      if (info.urls.length >= MAX_SITEMAP_URLS) {
        info.truncated = true;
        return false;
      }
      const loc = $(el).text().trim();
      if (!loc) return;
      if (!isSameSite(loc, origin)) {
        info.offSiteCount++;
        return;
      }
      const key = urlKey(loc);
      if (seenUrls.has(key)) return;
      seenUrls.add(key);
      info.urls.push(loc);
    });
    if (info.urls.length >= MAX_SITEMAP_URLS) {
      info.truncated = true;
      break;
    }
  }

  return info;
}

export async function discover(startUrl: string): Promise<DiscoveryResult> {
  // Resolve the start URL first so the audit is scoped to wherever the site
  // actually lives (http → https, apex → www, etc.).
  const start = await safeFetch(startUrl, { wantBody: () => false });
  if (start.error) {
    throw new DiscoveryError(`Couldn't reach ${startUrl}: ${start.error}`);
  }
  if (start.status >= 400) {
    throw new DiscoveryError(`${startUrl} returned HTTP ${start.status}.`);
  }
  const resolvedStart = start.finalUrl;
  const origin = new URL(resolvedStart).origin;

  const robots = await readRobots(origin);
  const sitemap = await readSitemaps(origin, robots.sitemaps);

  return { startUrl: resolvedStart, origin, robots, sitemap };
}
