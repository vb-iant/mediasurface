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
import { isSameSite } from "./urls";
import type { OnPageData } from "./types";

const MAX_LINKS_PER_PAGE = 2000;

export interface ExtractedHtml {
  title: string | null;
  internalLinks: string[];
  externalLinkCount: number;
  onPage: OnPageData;
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

  $("a[href]").each((_, el) => {
    if (internal.size + external.size >= MAX_LINKS_PER_PAGE) return false;
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#")) return;
    if (/^(mailto|tel|javascript|data|sms|ftp):/i.test(href)) return;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      return;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    resolved.hash = "";
    const abs = resolved.toString();

    if (isSameSite(abs, origin)) internal.add(abs);
    else external.add(abs);
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
    onPage,
  };
}
