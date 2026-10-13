/**
 * Content scan extraction (phase 6). Server-only: runs inside the page fetch
 * with the cheerio document extract.ts already parsed, so the full text is
 * read once and only a small summary travels back to the browser.
 */

import "server-only";
import type * as cheerio from "cheerio";
import type { PageContent } from "../types";
import { countIn, isContentWord, ngrams, segments, stem, type TargetPhrase } from "./text";

const MAX_HEADINGS = 30;
const MAX_HEADING_CHARS = 120;
const INTRO_WORDS = 60;
/** Top phrases kept per page: the most frequent overall, plus the most frequent multi-word ones. */
const TOP_TERMS = 25;
const TOP_MULTIWORD = 15;

const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, div, td, th, dt, dd, blockquote, figcaption, section, article, pre, tr";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function extractContent($: cheerio.CheerioAPI, phrases: TargetPhrase[]): PageContent {
  const main = $("body").clone();
  main.find("script, style, noscript, template, svg, nav, header, footer, aside, form").remove();

  const headings = main
    .find("h2, h3")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean)
    .slice(0, MAX_HEADINGS)
    .map((h) => clip(h, MAX_HEADING_CHARS));

  // Opening paragraphs: skip short bits (bylines, dates, captions).
  const introWords: string[] = [];
  main.find("p").each((_, el) => {
    if (introWords.length >= INTRO_WORDS) return false;
    const w = $(el).text().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (w.length >= 8) introWords.push(...w);
  });

  // Keep block boundaries so phrases don't run from a heading into the next paragraph.
  main.find("br").replaceWith("\n");
  main.find(BLOCKS).each((_, el) => {
    $(el).append("\n");
  });
  const text = main.text();
  const runs = segments(text);
  let totalWords = 0;
  for (const r of runs) totalWords += r.length;
  if (introWords.length === 0) introWords.push(...text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, INTRO_WORDS));

  // Count phrases; remember the commonest way each was written.
  const counts = new Map<string, number>();
  const surfaces = new Map<string, Map<string, number>>();
  for (const run of runs) {
    for (const [key, surface] of ngrams(run)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      let s = surfaces.get(key);
      if (!s) surfaces.set(key, (s = new Map()));
      s.set(surface, (s.get(surface) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length);
  const chosen = new Set<string>(ranked.slice(0, TOP_TERMS).map(([k]) => k));
  for (const [k] of ranked.filter(([k]) => k.includes(" ")).slice(0, TOP_MULTIWORD)) chosen.add(k);
  const terms: [string, number][] = ranked
    .filter(([k]) => chosen.has(k))
    .map(([k, n]) => {
      const best = [...surfaces.get(k)!.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return [best, n];
    });

  // Target phrases against the full text, per run (a match can't span runs).
  const runTokens = runs.map((r) => r.filter(isContentWord).map(stem));
  const phraseHits: Record<string, number> = {};
  for (const p of phrases) {
    let n = 0;
    for (const t of runTokens) n += countIn(t, p);
    phraseHits[p.key] = n;
  }

  return {
    headings,
    intro: introWords.slice(0, INTRO_WORDS).join(" "),
    terms,
    words: totalWords,
    phraseHits,
  };
}
