/**
 * HTML → structured page data. Server-only (cheerio).
 *
 * Extracts what the crawl needs (title, links) and what the phase 2
 * on-page checks need (meta description, H1s, canonical, robots, lang,
 * Open Graph, image alt text). The checks themselves live in findings.ts
 * and run in the browser over this data — nothing here judges a page.
 */

import "server-only";
import * as cheerio from "cheerio";
import { isSameSite, looksLikePage } from "./urls";
import type { OnPageData, StructuredDataInfo, StructuredDataItem } from "./types";

const MAX_LINKS_PER_PAGE = 2000;
const MAX_LINK_TEXT = 80;

export interface ExtractedHtml {
  title: string | null;
  internalLinks: string[];
  externalLinkCount: number;
  externalLinks: string[];
  assetLinks: string[];
  linkText: Record<string, string>;
  onPage: OnPageData;
}

function shortText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_LINK_TEXT ? `${t.slice(0, MAX_LINK_TEXT - 1)}…` : t;
}

function clean(text: string | undefined | null): string | null {
  if (text == null) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed || null;
}

function resolve(href: string | undefined, base: string): string | null {
  if (!href || !href.trim()) return null;
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return null;
  }
}

export function extractHtml(
  html: string,
  pageUrl: string,
  origin: string,
  xRobotsTag: string | null = null
): ExtractedHtml {
  const $ = cheerio.load(html);

  // <title> inside <svg> is an SVG tooltip, not the page title.
  const titles = $("title").filter((_, el) => $(el).parents("svg").length === 0);
  const title = clean(titles.first().text());

  // Respect <base href> when resolving relative URLs.
  let base = pageUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) base = resolve(baseHref, pageUrl) ?? pageUrl;

  const internal = new Set<string>();
  const external = new Set<string>();
  const assets = new Set<string>();
  const linkText: Record<string, string> = {};
  const total = () => internal.size + external.size + assets.size;

  const toAbsolute = (raw: string | undefined): string | null => {
    const href = (raw ?? "").trim();
    if (!href || href.startsWith("#")) return null;
    if (/^(mailto|tel|javascript|data|sms|ftp|blob):/i.test(href)) return null;
    try {
      const resolved = new URL(href, base);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
      resolved.hash = "";
      return resolved.toString();
    } catch {
      return null;
    }
  };

  $("a[href]").each((_, el) => {
    if (total() >= MAX_LINKS_PER_PAGE) return false;
    const abs = toAbsolute($(el).attr("href"));
    if (!abs) return;
    if (!(abs in linkText)) {
      const text =
        shortText($(el).text()) ||
        shortText($(el).attr("aria-label") ?? "") ||
        shortText($(el).find("img[alt]").first().attr("alt") ?? "") ||
        "(no link text)";
      linkText[abs] = text;
    }
    if (!isSameSite(abs, origin)) external.add(abs);
    else if (looksLikePage(abs)) internal.add(abs);
    else assets.add(abs); // PDFs, downloads, images linked directly
  });

  // Same-site images. External image hosts (CDNs) aren't checked — the
  // scope is this site's own files plus outbound <a> links.
  $("img[src]").each((_, el) => {
    if (total() >= MAX_LINKS_PER_PAGE) return false;
    const abs = toAbsolute($(el).attr("src"));
    if (!abs || !isSameSite(abs, origin)) return;
    assets.add(abs);
    if (!(abs in linkText)) {
      const alt = shortText($(el).attr("alt") ?? "");
      linkText[abs] = alt ? `Image: ${alt}` : "Image";
    }
  });

  // meta name matching is case-insensitive in practice (Name="Description").
  const metaByName = (name: string) =>
    $("meta[name]").filter((_, el) => ($(el).attr("name") ?? "").toLowerCase() === name);
  const metaByProperty = (prop: string) =>
    $("meta[property]").filter((_, el) => ($(el).attr("property") ?? "").toLowerCase() === prop);

  const descriptions = metaByName("description");
  const robots = [...metaByName("robots").toArray(), ...metaByName("googlebot").toArray()]
    .map((el) => clean($(el).attr("content"))?.toLowerCase())
    .filter((v): v is string => Boolean(v));
  const canonicals = $("link[rel]").filter((_, el) =>
    ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical")
  );

  const images = $("img");
  let imagesMissingAlt = 0;
  images.each((_, el) => {
    if ($(el).attr("alt") === undefined) imagesMissingAlt++;
  });

  const onPage: OnPageData = {
    structuredData: extractStructuredData($),
    hasViewport: $("meta[name]").filter((_, el) => ($(el).attr("name") ?? "").toLowerCase() === "viewport").length > 0,
    ...mixedContent($, pageUrl, base),
    wordCount: countWords($),
    hreflang: $("link[rel][hreflang]")
      .filter((_, el) => ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/).includes("alternate"))
      .map((_, el) => ({ lang: ($(el).attr("hreflang") ?? "").trim(), href: resolve($(el).attr("href"), base) ?? "" }))
      .get()
      .filter((h) => h.lang && h.href)
      .slice(0, 50),
    titleCount: titles.length,
    metaDescription: clean(descriptions.first().attr("content")),
    metaDescriptionCount: descriptions.length,
    h1s: $("h1").map((_, el) => clean($(el).text()) ?? "").get(),
    canonical: resolve(canonicals.first().attr("href"), base),
    canonicalCount: canonicals.length,
    metaRobots: robots.length ? robots.join(", ") : null,
    xRobotsTag: xRobotsTag ? xRobotsTag.toLowerCase() : null,
    lang: clean($("html").attr("lang")),
    ogTitle: clean(metaByProperty("og:title").first().attr("content")),
    ogDescription: clean(metaByProperty("og:description").first().attr("content")),
    ogImage: resolve(metaByProperty("og:image").first().attr("content"), base),
    imageCount: images.length,
    imagesMissingAlt,
  };

  return {
    title,
    internalLinks: [...internal],
    externalLinkCount: external.size,
    externalLinks: [...external],
    assetLinks: [...assets],
    linkText,
    onPage,
  };
}

/** Non-empty = not null/undefined, not "", not an empty array or object. */
function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function toItems(node: unknown, out: StructuredDataItem[], depth = 0): void {
  if (depth > 4 || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) toItems(n, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) {
    for (const n of obj["@graph"] as unknown[]) toItems(n, out, depth + 1);
    return;
  }
  const rawType = obj["@type"];
  const types = (Array.isArray(rawType) ? rawType : rawType ? [rawType] : [])
    .filter((t): t is string => typeof t === "string")
    // "https://schema.org/Article" → "Article"
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, ""));
  const keys = Object.keys(obj).filter((k) => !k.startsWith("@") && hasValue(obj[k]));
  out.push({ types, keys });
}

function extractStructuredData($: cheerio.CheerioAPI): StructuredDataInfo {
  const items: StructuredDataItem[] = [];
  const parseErrors: string[] = [];
  $('script[type="application/ld+json" i]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      toItems(JSON.parse(raw), items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parseErrors.push(msg.length > 100 ? `${msg.slice(0, 99)}…` : msg);
    }
  });
  const microdataTypes = [
    ...new Set(
      $("[itemtype]")
        .map((_, el) => ($(el).attr("itemtype") ?? "").replace(/^https?:\/\/schema\.org\//i, "").trim())
        .get()
        .filter(Boolean)
    ),
  ].slice(0, 20);
  return { items: items.slice(0, 50), parseErrors, microdataTypes, rdfaCount: $("[typeof]").length };
}

/** http:// subresources on an https page — browsers block or warn on these. */
function mixedContent($: cheerio.CheerioAPI, pageUrl: string, base: string): { mixedContent: string[]; mixedContentCount: number } {
  if (!pageUrl.startsWith("https:")) return { mixedContent: [], mixedContentCount: 0 };
  const found = new Set<string>();
  const check = (raw: string | undefined) => {
    const abs = resolve(raw, base);
    if (abs && abs.startsWith("http:")) found.add(abs);
  };
  $("img[src], script[src], iframe[src], video[src], audio[src], source[src], embed[src]").each((_, el) => check($(el).attr("src")));
  $("link[href]").each((_, el) => {
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    if (/stylesheet|icon|preload|manifest/.test(rel)) check($(el).attr("href"));
  });
  const all = [...found];
  return { mixedContent: all.slice(0, 5), mixedContentCount: all.length };
}

/** Visible body words, ignoring scripts, styles and site chrome (nav/header/footer/aside). */
function countWords($: cheerio.CheerioAPI): number {
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg, nav, header, footer, aside, form").remove();
  const text = body.text().replace(/\s+/g, " ").trim();
  return text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}
