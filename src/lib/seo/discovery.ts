/**
 * Discovery: resolve the start URL, read robots.txt, read sitemaps.
 * Server-only.
 */

import "server-only";
import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { safeFetch } from "./fetch-page";
import { isAllowedByRobots, parseRobots, rulesFor, type ParsedGroup } from "./robots";
import { AI_BOTS } from "./ai-bots";
import { isSameSite, urlKey } from "./urls";
import type { AiAccessInfo, DiscoveryResult, HostVariant, RobotsInfo, SitemapInfo } from "./types";

const MAX_SITEMAP_FILES = 50;
const MAX_SITEMAP_URLS = 5000;
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;

export class DiscoveryError extends Error {}

async function readRobots(origin: string): Promise<RobotsInfo & { groups: ParsedGroup[] }> {
  const url = new URL("/robots.txt", origin).toString();
  const res = await safeFetch(url, { accept: "text/plain,*/*;q=0.5", maxBytes: 512 * 1024 });

  const empty: RobotsInfo & { groups: ParsedGroup[] } = {
    groups: [],
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
    groups: parsed.groups,
  };
}

/** What robots.txt allows each AI crawler to do, plus whether /llms.txt exists. */
async function readAiAccess(origin: string, startUrl: string, groups: ParsedGroup[]): Promise<AiAccessInfo> {
  const root = new URL("/", origin).toString();
  const bots = AI_BOTS.map((b) => {
    const { rules, explicit } = rulesFor(groups, b.token);
    return {
      token: b.token,
      allowedRoot: isAllowedByRobots(root, rules),
      allowedStart: isAllowedByRobots(startUrl, rules),
      explicit,
    };
  });

  const url = new URL("/llms.txt", origin).toString();
  const res = await safeFetch(url, { accept: "text/plain,text/markdown,*/*;q=0.5", maxBytes: 256 * 1024 });
  let llmsTxt: AiAccessInfo["llmsTxt"];
  if (res.error) llmsTxt = { url, status: "error", detail: res.error };
  else if (res.status !== 200) llmsTxt = { url, status: "missing", detail: `HTTP ${res.status}` };
  else if (/^\s*</.test(res.body.toString("utf8", 0, 200)) || /html/i.test(res.contentType ?? "")) {
    llmsTxt = { url, status: "html", detail: "Returns an HTML page, not an llms.txt file" };
  } else {
    const lines = res.body.toString("utf8").split(/\r?\n/).filter((l) => l.trim()).length;
    llmsTxt = { url, status: "found", detail: `${lines} line${lines === 1 ? "" : "s"}` };
  }
  return { bots, llmsTxt };
}

/**
 * Request the homepage on http/https × apex/www. Each should land on the
 * one origin the site serves from, ideally in one hop. 4 extra requests.
 */
async function readHostVariants(origin: string): Promise<HostVariant[]> {
  const canonical = new URL(origin);
  const apex = canonical.hostname.replace(/^www\./, "");
  const variants = [`http://${apex}/`, `http://www.${apex}/`, `https://${apex}/`, `https://www.${apex}/`];
  return Promise.all(
    variants.map(async (url) => {
      const r = await safeFetch(url, { wantBody: () => false, timeoutMs: 10_000 });
      let reachesCanonical = false;
      try {
        reachesCanonical = new URL(r.finalUrl).origin === canonical.origin && !r.error && r.status < 400;
      } catch {
        /* leave false */
      }
      return {
        url,
        finalUrl: r.finalUrl,
        status: r.status,
        hops: r.redirectChain.length,
        error: r.error,
        reachesCanonical,
        hsts: r.headers["strict-transport-security"] ?? null,
      };
    })
  );
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

  const { groups, ...robots } = await readRobots(origin);
  const [sitemap, ai, hosts] = await Promise.all([
    readSitemaps(origin, robots.sitemaps),
    readAiAccess(origin, resolvedStart, groups),
    readHostVariants(origin),
  ]);

  return { startUrl: resolvedStart, origin, robots, sitemap, ai, hosts };
}
