/**
 * HTML → structured page data. Server-only (cheerio).
 *
 * Phase 1 extracts what the crawl and inventory need: title and links.
 * Phase 2's on-page checks extend this (meta description, H1s, canonical,
 * robots meta, etc.) — add fields here rather than re-parsing elsewhere.
 */

import "server-only";
import * as cheerio from "cheerio";
import { isSameSite } from "./urls";

const MAX_LINKS_PER_PAGE = 2000;

export interface ExtractedHtml {
  title: string | null;
  internalLinks: string[];
  externalLinkCount: number;
}

export function extractHtml(html: string, pageUrl: string, origin: string): ExtractedHtml {
  const $ = cheerio.load(html);

  const rawTitle = $("head > title").first().text() || $("title").first().text();
  const title = rawTitle.replace(/\s+/g, " ").trim() || null;

  // Respect <base href> when resolving relative links.
  let base = pageUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).toString();
    } catch {
      /* ignore a malformed <base> */
    }
  }

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

  return {
    title,
    internalLinks: [...internal],
    externalLinkCount: external.size,
  };
}
