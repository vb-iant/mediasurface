/**
 * Content scan model (phase 6): site topic map, what each page targets, and
 * the target phrase check — all derived in the browser from the scan's pages,
 * never stored (same rule as findings.ts for the technical audit).
 *
 * Pure. Scoring is deliberately simple and explainable:
 * - A phrase scores for a page by WHERE it appears — title and H1 weigh most,
 *   then the URL, meta description, subheadings and opening paragraph — plus
 *   how often it appears in the main text, relative to the page's commonest
 *   phrase. Two- and three-word phrases get a modest boost (they say more).
 * - Phrases on nearly every page (brand name in title suffixes, nav-like
 *   text) are dropped as boilerplate; phrases common across the site are
 *   damped (TF-IDF-style), but not removed — a sales site should still show
 *   "sales".
 * - No keyword density anywhere (not a ranking factor; encourages stuffing).
 *
 * English only, crawl-only: no search volume, difficulty or rankings.
 */

import { isNoindex } from "../checks/on-page";
import type { AuditPage, AuditResult } from "../types";
import { isSameSite, urlKey } from "../urls";
import {
  contentTokens,
  countIn,
  looseKey,
  ngrams,
  parseTarget,
  phraseKey,
  segments,
  slugText,
  type TargetPhrase,
} from "./text";

export const MAX_TARGET_PHRASES = 20;

export type Field = "title" | "h1" | "url" | "description" | "headings" | "intro" | "body" | "links";

export const FIELD_LABEL: Record<Field, string> = {
  title: "Title",
  h1: "H1",
  url: "URL",
  description: "Meta description",
  headings: "Subheadings",
  intro: "Opening",
  body: "Body",
  links: "Link text",
};

/** Where a phrase appears, and how much that counts towards "this page targets it". */
const WEIGHT: Record<Exclude<Field, "body" | "links">, number> = {
  title: 3,
  h1: 3,
  url: 2,
  description: 1.5,
  headings: 1,
  intro: 1,
};
const BODY_WEIGHT = 1.5;
const LENGTH_BOOST = [1, 1, 1.35, 1.5];
/** A phrase in this share of titles (or bodies) is the brand or boilerplate. */
const BOILERPLATE_TITLE_SHARE = 0.3;
const BOILERPLATE_BODY_SHARE = 0.8;
/** Boilerplate detection needs enough pages to mean anything. */
const BOILERPLATE_MIN_PAGES = 5;
const CANDIDATES_PER_PAGE = 30;
const SECTION_PHRASES = 10;
const SITE_PHRASES = 15;

export type Clarity = "clear" | "mixed" | "weak" | "none";

export interface ContentPage {
  url: string;
  section: string;
  title: string | null;
  h1: string | null;
  /** Inferred focus phrase, as written on the page. */
  focus: string | null;
  focusKey: string | null;
  clarity: Clarity;
  /** Where the focus phrase appears. */
  focusFields: Field[];
  /** Runner-up phrases, for the row details. */
  alsoAbout: string[];
  words: number;
  /** Set when title, H1 and URL point at different things. */
  mixed: string | null;
}

export interface TopicPhrase {
  text: string;
  key: string;
  pages: number;
  /** Up to 3 pages where it scores highest. */
  examples: string[];
}

export interface TopicSection {
  id: string;
  label: string;
  pageCount: number;
  phrases: TopicPhrase[];
}

export interface TargetHit {
  url: string;
  title: string | null;
  score: number;
  where: Field[];
  bodyCount: number;
}

export interface TargetResult {
  phrase: string;
  key: string;
  /** Pages that target it (title, H1 or URL, plus supporting signals), best first. */
  targeting: TargetHit[];
  /** Pages that only mention it in the text, most mentions first. */
  mentions: TargetHit[];
}

export interface ContentFindingRow {
  label: string;
  url?: string;
  note?: string;
}

/**
 * Content scan findings. Severity (Claude's advice, 2026-10-13, for Ian to
 * confirm): an untargeted target phrase is a warning (a fact, and the
 * client asked for it); competing pages and mixed signals are notices
 * (inferred, and often deliberate). No errors: nothing here is broken.
 */
export interface ContentFinding {
  id: "content-untargeted" | "content-competing" | "content-mixed";
  title: string;
  severity: "warning" | "info";
  description: string;
  why: string;
  how: string;
  rows: ContentFindingRow[];
}

export interface ContentModel {
  pages: ContentPage[];
  /** Pages crawled but not analysed (redirects, errors, noindex, listings, duplicates). */
  skipped: number;
  site: TopicPhrase[];
  sections: TopicSection[];
  targets: TargetResult[];
  findings: ContentFinding[];
  /** Phrases dropped as brand/boilerplate, for transparency. */
  boilerplate: string[];
}

// ------------------------------------------------------------ which pages

function isListing(url: string): boolean {
  try {
    const u = new URL(url);
    // Filters (?tag=), listing pages (/page/2) and split posts (/post-name/2/).
    return u.search.length > 0 || /\/page\/\d+\/?$/i.test(u.pathname) || /\/\d+\/?$/.test(u.pathname);
  } catch {
    return true;
  }
}

/** Pages worth reading for content: load, HTML, this site, indexable, not a filtered/paginated listing or declared duplicate. */
export function isContentPage(p: AuditPage, origin: string): boolean {
  if (p.status !== 200 || !p.isHtml || p.redirectChain.length > 0 || !p.content || !p.onPage) return false;
  if (!isSameSite(p.finalUrl, origin) || isNoindex(p.onPage) || isListing(p.finalUrl)) return false;
  const canonical = p.onPage.canonical;
  if (canonical && isSameSite(canonical, origin) && urlKey(canonical) !== urlKey(p.finalUrl)) return false;
  return true;
}

function sectionOf(url: string): string {
  try {
    const first = new URL(url).pathname.split("/").filter(Boolean)[0];
    return first ? `/${decodeURIComponent(first)}` : "/";
  } catch {
    return "/";
  }
}

// ------------------------------------------------------------ titles

const TITLE_SPLIT = /\s+[|–—·•:-]\s+|\s+-\s+/;

/** Title parts repeated across the site ("… | Velocity-B"), worked out once. */
function repeatedTitleParts(titles: string[]): Set<string> {
  const out = new Set<string>();
  if (titles.length < BOILERPLATE_MIN_PAGES) return out;
  // A site can use more than one ("— Velocity-B" and "— Velocity-B Blog"),
  // so any last part used as a suffix three or more times counts.
  const counts = new Map<string, number>();
  const suffixes = new Map<string, number>();
  let split = 0;
  for (const t of titles) {
    const parts = t.split(TITLE_SPLIT).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length < 2) continue;
    split++;
    const last = parts[parts.length - 1];
    suffixes.set(last, (suffixes.get(last) ?? 0) + 1);
    for (const part of new Set(parts)) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  for (const [part, n] of suffixes) if (n >= 3) out.add(part);
  for (const [part, n] of counts) if (n >= 3 && n / split >= BOILERPLATE_TITLE_SHARE) out.add(part);
  return out;
}

function stripTitle(title: string, repeated: Set<string>): string {
  const parts = title.split(TITLE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const kept = parts.filter((p) => !repeated.has(p.toLowerCase()));
  return (kept.length ? kept : parts).join(" — ");
}

// ------------------------------------------------------------ per-page phrases

interface Prepared {
  page: AuditPage;
  url: string;
  section: string;
  title: string | null;
  strippedTitle: string;
  h1: string | null;
  fields: Record<Exclude<Field, "body" | "links">, Set<string>>;
  /** key → main-text count (top phrases only). */
  body: Map<string, number>;
  maxBody: number;
  /** The page's own subheadings (see headingFilter). */
  headings: string[];
  surfaces: Map<string, string>;
  allKeys: Set<string>;
}

function keysOf(texts: string[], surfaces: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const run of segments(text)) {
      for (const [key, surface] of ngrams(run)) {
        if (!key) continue;
        out.add(key);
        if (!surfaces.has(key)) surfaces.set(key, surface);
      }
    }
  }
  return out;
}

/**
 * Subheadings that aren't this page's own: "Related posts", "Stay up to
 * date" (on many pages), and cards titled with another page's title or H1
 * (related-post lists, author boxes). Found on velocity-b.com, 2026-10-13.
 */
function headingFilter(pages: AuditPage[]): (heading: string, page: AuditPage) => boolean {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const owners = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const p of pages) {
    for (const t of [p.title, ...(p.onPage?.h1s ?? [])]) {
      if (!t) continue;
      const k = norm(t);
      let set = owners.get(k);
      if (!set) owners.set(k, (set = new Set()));
      set.add(p.finalUrl);
      // Titles with a suffix: the part before it is also how cards show the page.
      const head = norm(t.split(TITLE_SPLIT)[0] ?? "");
      if (head && head !== k) {
        let s2 = owners.get(head);
        if (!s2) owners.set(head, (s2 = new Set()));
        s2.add(p.finalUrl);
      }
    }
    for (const h of new Set((p.content?.headings ?? []).map(norm))) df.set(h, (df.get(h) ?? 0) + 1);
  }
  const common = Math.max(3, pages.length * 0.2);
  return (heading, page) => {
    const k = norm(heading);
    if ((df.get(k) ?? 0) >= common) return false;
    const own = owners.get(k);
    return !own || own.has(page.finalUrl);
  };
}

function prepare(page: AuditPage, repeated: Set<string>, ownHeading: (h: string, p: AuditPage) => boolean): Prepared {
  const op = page.onPage!;
  const c = page.content!;
  const headings = c.headings.filter((h) => ownHeading(h, page));
  const surfaces = new Map<string, string>();
  const title = page.title;
  const strippedTitle = title ? stripTitle(title, repeated) : "";
  const h1 = op.h1s.find((h) => h.trim()) ?? null;
  const body = new Map<string, number>();
  for (const [surface, n] of c.terms) {
    const k = phraseKey(surface);
    if (!k) continue;
    body.set(k, Math.max(body.get(k) ?? 0, n));
    if (!surfaces.has(k)) surfaces.set(k, surface);
  }
  // Field surfaces are preferred over body ones (they're how the page names itself).
  const fieldSurfaces = new Map<string, string>();
  const fields = {
    title: keysOf([strippedTitle], fieldSurfaces),
    h1: keysOf(op.h1s, fieldSurfaces),
    url: keysOf([slugText(page.finalUrl)], new Map()),
    description: keysOf([op.metaDescription ?? ""], fieldSurfaces),
    headings: keysOf(headings, fieldSurfaces),
    intro: keysOf([c.intro], fieldSurfaces),
  };
  for (const [k, s] of fieldSurfaces) surfaces.set(k, s);
  const allKeys = new Set<string>(body.keys());
  for (const set of Object.values(fields)) for (const k of set) allKeys.add(k);
  return {
    page,
    url: page.finalUrl,
    section: sectionOf(page.finalUrl),
    title,
    strippedTitle,
    h1,
    fields,
    body,
    maxBody: Math.max(1, ...body.values()),
    headings,
    surfaces,
    allKeys,
  };
}

interface Scored {
  key: string;
  score: number;
  fields: Field[];
}

function scorePage(p: Prepared, idfNorm: (k: string) => number, boilerplate: Set<string>): Scored[] {
  const out: Scored[] = [];
  for (const key of p.allKeys) {
    if (boilerplate.has(key)) continue;
    const fields: Field[] = [];
    let fieldScore = 0;
    for (const f of Object.keys(WEIGHT) as (keyof typeof WEIGHT)[]) {
      if (p.fields[f].has(key)) {
        fieldScore += WEIGHT[f];
        fields.push(f);
      }
    }
    const tf = p.body.get(key) ?? 0;
    if (tf > 0) fields.push("body");
    // A phrase only in the body has to be used more than in passing.
    if (fieldScore === 0 && tf < 3) continue;
    const n = key.split(" ").length;
    const base = fieldScore + (BODY_WEIGHT * tf) / p.maxBody;
    out.push({ key, score: base * (LENGTH_BOOST[n] ?? 1.5) * (0.4 + 0.6 * idfNorm(key)), fields });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, CANDIDATES_PER_PAGE);
}

/** For display: drop decorative leading symbols ("›", ">", "—"). */
function tidy(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/** Shares no meaningful word: tokens minus boilerplate words. */
function disjoint(a: string, b: string, noise: Set<string>): boolean {
  const ta = new Set(contentTokens(a).filter((t) => !noise.has(t)));
  const tb = contentTokens(b).filter((t) => !noise.has(t));
  if (ta.size === 0 || tb.length === 0) return false;
  return !tb.some((t) => ta.has(t));
}

// ------------------------------------------------------------ the model

export function buildContentModel(audit: AuditResult, phraseInput: string[] = []): ContentModel {
  const origin = audit.discovery.origin;
  const raw = audit.pages.filter((p) => isContentPage(p, origin));
  // Same page reached twice (www/apex, trailing slash) counts once.
  const seen = new Set<string>();
  const contentPages = raw.filter((p) => {
    const k = urlKey(p.finalUrl);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const N = contentPages.length;

  const repeated = repeatedTitleParts(contentPages.map((p) => p.title ?? "").filter(Boolean));
  const ownHeading = headingFilter(contentPages);
  const prepared = contentPages.map((p) => prepare(p, repeated, ownHeading));

  // Document frequency, over every field and the body's top phrases.
  const df = new Map<string, number>();
  const titleDf = new Map<string, number>();
  const headDf = new Map<string, number>();
  const bodyDf = new Map<string, number>();
  for (const p of prepared) {
    for (const k of p.allKeys) df.set(k, (df.get(k) ?? 0) + 1);
    for (const k of p.fields.title) titleDf.set(k, (titleDf.get(k) ?? 0) + 1);
    for (const k of new Set([...p.fields.title, ...p.fields.h1])) headDf.set(k, (headDf.get(k) ?? 0) + 1);
    for (const k of p.body.keys()) bodyDf.set(k, (bodyDf.get(k) ?? 0) + 1);
  }
  const boilerplate = new Set<string>();
  if (N >= BOILERPLATE_MIN_PAGES) {
    for (const [k, n] of titleDf) if (n / N >= BOILERPLATE_TITLE_SHARE) boilerplate.add(k);
    // Body text on nearly every page is boilerplate only if no page is
    // titled with it — "sales" on a sales consultancy's site is the topic.
    for (const [k, n] of bodyDf) if (n / N >= BOILERPLATE_BODY_SHARE && !headDf.has(k)) boilerplate.add(k);
  }
  // A repeated title part (the brand) is noise as a whole phrase — but not
  // word by word: "Content Bloom" mustn't knock out "content".
  for (const part of repeated) {
    const k = phraseKey(part);
    if (!k) continue;
    boilerplate.add(k);
    // Its single words go too, unless pages use them in titles or H1s outside
    // the brand name ("content" on Content Bloom's site stays; "bloom" goes).
    const words = k.split(" ");
    if (words.length < 2) continue;
    const brand = new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const w of words) {
      let own = 0;
      for (const p of prepared) {
        const head = `${p.strippedTitle} ${p.h1 ?? ""}`.replace(brand, " ");
        if (contentTokens(head).includes(w)) own++;
      }
      if (own < 3) boilerplate.add(w);
    }
  }
  const noiseTokens = new Set<string>();
  for (const k of boilerplate) if (!k.includes(" ")) noiseTokens.add(k);

  const maxIdf = Math.log(N + 1) + 1;
  const idfNorm = (k: string) => (Math.log((N + 1) / ((df.get(k) ?? 0) + 1)) + 1) / maxIdf;

  const scoredByPage = prepared.map((p) => scorePage(p, idfNorm, boilerplate));

  // People's names (author, team pages) are left out of the topic map —
  // bylines and "In this post, Alex…" descriptions aren't what a site is about.
  const personTokens = new Set<string>();
  for (const p of prepared) {
    if (/\/(?:author|authors|team|people|staff)\//i.test(new URL(p.url).pathname)) {
      for (const t of contentTokens(p.strippedTitle || p.h1 || "")) personTokens.add(t);
    }
  }
  const isPerson = (key: string) => personTokens.size > 0 && key.split(" ").every((t) => personTokens.has(t));

  // What each page targets ------------------------------------------------
  const pages: ContentPage[] = prepared.map((p, i) => {
    const scored = scoredByPage[i];
    const best = scored[0];
    let mixed: string | null = null;
    if (p.strippedTitle && p.h1 && disjoint(p.strippedTitle, p.h1, noiseTokens)) {
      mixed = `Title “${tidy(p.strippedTitle)}” and H1 “${tidy(p.h1)}” share no words`;
    } else {
      const slug = slugText(p.url);
      const slugTokens = contentTokens(slug).filter((t) => !noiseTokens.has(t));
      if (
        slugTokens.length >= 2 &&
        !/^\d+$/.test(slug.replace(/\s/g, "")) &&
        p.strippedTitle &&
        disjoint(p.strippedTitle, slug, noiseTokens) &&
        (!p.h1 || disjoint(p.h1, slug, noiseTokens))
      ) {
        mixed = `URL “${slug}” shares no words with the title${p.h1 ? " or H1" : ""}`;
      }
    }
    let clarity: Clarity = "none";
    if (best) {
      const inTitle = best.fields.includes("title");
      const backed = best.fields.includes("h1") || best.fields.includes("url");
      clarity = inTitle && backed ? "clear" : mixed ? "mixed" : "weak";
    }
    return {
      url: p.url,
      section: p.section,
      title: p.title,
      h1: p.h1,
      focus: best ? p.surfaces.get(best.key) ?? best.key : null,
      focusKey: best?.key ?? null,
      clarity: mixed && clarity === "clear" ? "mixed" : clarity,
      focusFields: best?.fields ?? [],
      alsoAbout: scored
        .slice(1)
        .filter((s) => !best || !best.key.split(" ").some((t) => s.key === t))
        .slice(0, 3)
        .map((s) => p.surfaces.get(s.key) ?? s.key),
      words: p.page.content?.words ?? 0,
      mixed,
    };
  });

  // Topic map --------------------------------------------------------------
  const topics = (indices: number[], limit: number): TopicPhrase[] => {
    const agg = new Map<string, { score: number; pages: { url: string; s: number }[] }>();
    for (const i of indices) {
      const scored = scoredByPage[i];
      const top = scored[0]?.score || 1;
      for (const s of scored) {
        // Counts for the topic map only where the page names it — title,
        // H1, URL, description, subheadings or opening paragraph — so
        // bylines and author bios lower down don't read as topics.
        if (s.fields.every((f) => f === "body") || isPerson(s.key)) continue;
        let a = agg.get(s.key);
        if (!a) agg.set(s.key, (a = { score: 0, pages: [] }));
        a.score += s.score / top;
        a.pages.push({ url: prepared[i].url, s: s.score });
      }
    }
    const minPages = indices.length >= 3 ? 2 : 1;
    const ranked = [...agg.entries()]
      .filter(([, a]) => a.pages.length >= minPages)
      .sort((x, y) => y[1].score - x[1].score);
    const chosen: [string, (typeof ranked)[number][1]][] = [];
    for (const entry of ranked) {
      if (chosen.length >= limit) break;
      const [key, a] = entry;
      const toks = key.split(" ");
      // Drop a word or phrase already covered by a longer chosen phrase on most of the same pages.
      const covered = chosen.some(([k2, a2]) => {
        const t2 = k2.split(" ");
        return t2.length > toks.length && toks.every((t) => t2.includes(t)) && a2.pages.length >= 0.6 * a.pages.length;
      });
      if (covered) continue;
      // And replace a chosen shorter phrase this one now covers.
      for (let j = chosen.length - 1; j >= 0; j--) {
        const t1 = chosen[j][0].split(" ");
        if (toks.length > t1.length && t1.every((t) => toks.includes(t)) && a.pages.length >= 0.6 * chosen[j][1].pages.length) {
          chosen.splice(j, 1);
        }
      }
      chosen.push(entry);
    }
    const surfaceOf = (key: string) => {
      for (const i of indices) {
        const s = prepared[i].surfaces.get(key);
        if (s) return s;
      }
      return key;
    };
    return chosen.map(([key, a]) => ({
      key,
      text: surfaceOf(key),
      pages: a.pages.length,
      examples: [...a.pages].sort((x, y) => y.s - x.s).slice(0, 3).map((p) => p.url),
    }));
  };

  const bySection = new Map<string, number[]>();
  prepared.forEach((p, i) => {
    const list = bySection.get(p.section) ?? [];
    list.push(i);
    bySection.set(p.section, list);
  });
  // Sections with a single page fold into "Top-level pages".
  const top: number[] = [];
  const sections: TopicSection[] = [];
  for (const [id, indices] of bySection) {
    if (id === "/" || indices.length < 2) top.push(...indices);
    else sections.push({ id, label: `${id}/…`, pageCount: indices.length, phrases: topics(indices, SECTION_PHRASES) });
  }
  for (const i of top) pages[i].section = "Top-level pages";
  for (const s of sections) for (const i of bySection.get(s.id)!) pages[i].section = s.label;
  sections.sort((a, b) => b.pageCount - a.pageCount);
  if (top.length) sections.push({ id: "/", label: "Top-level pages", pageCount: top.length, phrases: topics(top, SECTION_PHRASES) });

  // Target phrases -----------------------------------------------------------
  const targets = targetCheck(audit, prepared, phraseInput);

  return {
    pages,
    skipped: audit.pages.length - N,
    site: topics(prepared.map((_, i) => i), SITE_PHRASES),
    sections,
    targets,
    findings: contentFindings(pages, targets),
    boilerplate: [...boilerplate]
      .sort((a, b) => (titleDf.get(b) ?? bodyDf.get(b) ?? 0) - (titleDf.get(a) ?? bodyDf.get(a) ?? 0))
      .slice(0, 10),
  };
}

/** Parse and de-duplicate what was typed (one phrase per line), up to the limit. */
export function parseTargets(input: string[]): TargetPhrase[] {
  const out: TargetPhrase[] = [];
  const keys = new Set<string>();
  for (const line of input) {
    const t = parseTarget(line);
    if (!t || keys.has(t.key)) continue;
    keys.add(t.key);
    out.push(t);
    if (out.length >= MAX_TARGET_PHRASES) break;
  }
  return out;
}

function targetCheck(audit: AuditResult, prepared: Prepared[], input: string[]): TargetResult[] {
  const phrases = parseTargets(input);
  if (phrases.length === 0) return [];

  // Internal link text pointing at each page (one per linking page).
  const anchors = new Map<string, Map<string, string>>();
  for (const src of audit.pages) {
    if (!src.isHtml || src.status >= 400) continue;
    for (const link of src.internalLinks) {
      const k = urlKey(link);
      let m = anchors.get(k);
      if (!m) anchors.set(k, (m = new Map()));
      const text = src.linkText?.[link];
      if (text && !m.has(src.finalUrl)) m.set(src.finalUrl, text);
    }
  }

  // Tokenise each page's fields once, not once per phrase.
  const tok = (t: string | null | undefined) => (t ? contentTokens(t) : []);
  const pageTokens = prepared.map((p) => {
    const op = p.page.onPage!;
    const c = p.page.content!;
    return {
      title: tok(p.strippedTitle || p.title),
      h1: op.h1s.map(tok),
      url: tok(pathText(p.url)),
      description: tok(op.metaDescription),
      headings: p.headings.map(tok),
      intro: tok(c.intro),
      links: [...(anchors.get(urlKey(p.url))?.values() ?? [])].map(tok),
    };
  });

  return phrases.map((phrase) => {
    const hits: (TargetHit & { targets: boolean })[] = [];
    prepared.forEach((p, i) => {
      const t = pageTokens[i];
      const has = (tokens: string[]) => countIn(tokens, phrase) > 0;
      const where: Field[] = [];
      let score = 0;
      const add = (f: Exclude<Field, "body" | "links">, yes: boolean) => {
        if (!yes) return;
        where.push(f);
        score += WEIGHT[f];
      };
      add("title", has(t.title));
      add("h1", t.h1.some(has));
      add("url", has(t.url));
      add("description", has(t.description));
      add("headings", t.headings.some(has));
      add("intro", has(t.intro));
      const bodyCount = p.page.content!.phraseHits?.[phrase.key] ?? 0;
      if (bodyCount > 0) {
        where.push("body");
        score += Math.min(bodyCount, 5) * 0.3;
      }
      if (t.links.some(has)) {
        where.push("links");
        score += 1;
      }
      if (where.length === 0) return;
      const targets = (where.includes("title") || where.includes("h1") || where.includes("url")) && score >= 3;
      hits.push({ url: p.url, title: p.title, score: Math.round(score * 10) / 10, where, bodyCount, targets });
    });
    const strip = (h: TargetHit & { targets: boolean }): TargetHit => ({ url: h.url, title: h.title, score: h.score, where: h.where, bodyCount: h.bodyCount });
    return {
      phrase: phrase.text,
      key: phrase.key,
      targeting: hits.filter((h) => h.targets).sort((a, b) => b.score - a.score).map(strip),
      mentions: hits
        .filter((h) => !h.targets)
        .sort((a, b) => b.bodyCount - a.bodyCount || b.score - a.score)
        .map(strip),
    };
  });
}

/** Every path segment's words ("/services/sales-forecasting/" → "services sales forecasting"). */
function pathText(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/[/\-_+.]+/g, " ");
  } catch {
    return "";
  }
}

function contentFindings(pages: ContentPage[], targets: TargetResult[]): ContentFinding[] {
  const out: ContentFinding[] = [];

  const untargeted = targets.filter((t) => t.targeting.length === 0);
  if (untargeted.length) {
    out.push({
      id: "content-untargeted",
      title: "Target phrases no page targets",
      severity: "warning",
      description: "No page uses these phrases in its title, H1 or URL. Where a page mentions one, the page with the most mentions is shown.",
      why: "Search engines work out what a page is about mostly from its title, main heading and URL. If no page puts a phrase there, the site is unlikely to be found for it — however often it appears in passing.",
      how: "Pick one page to own each phrase — an existing page if one already covers the topic, otherwise a new one — and use the phrase naturally in its title, H1 and URL, and early in the text. Link to that page from related pages using the phrase in the link text.",
      rows: untargeted.map((t) => {
        const best = t.mentions[0];
        return {
          label: `“${t.phrase}”`,
          url: best?.url,
          note: best
            ? `Mentioned on ${t.mentions.length} page${t.mentions.length === 1 ? "" : "s"}; most here (${best.bodyCount}×)`
            : "Not mentioned anywhere on the site",
        };
      }),
    });
  }

  // Competing pages: same focus (any word order).
  const groups = new Map<string, ContentPage[]>();
  for (const p of pages) {
    // Only clear focuses: an inferred phrase on a page with mixed signals is too shaky to call competition.
    if (!p.focus || p.clarity !== "clear") continue;
    const k = looseKey(p.focus);
    if (!k) continue;
    const list = groups.get(k) ?? [];
    list.push(p);
    groups.set(k, list);
  }
  const competing = [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length);
  if (competing.length) {
    out.push({
      id: "content-competing",
      title: "Pages competing for the same phrase",
      severity: "info",
      description: "These pages clearly target the same phrase (in their titles, plus H1 or URL). Often fine — check whether each has a distinct purpose.",
      why: "When several pages target the same phrase, search engines have to choose between them, and may rank none of them well or show the less useful one. This is often called keyword cannibalisation.",
      how: "Decide which page should rank for the phrase. Give the others a distinct angle (and title) of their own, merge them into the main page and redirect, or link from them to the main page using the phrase.",
      rows: competing.flatMap((g) =>
        g.map((p) => ({ label: `“${g[0].focus}”`, url: p.url, note: `${g.length} pages` }))
      ),
    });
  }

  const mixed = pages.filter((p) => p.mixed);
  if (mixed.length) {
    out.push({
      id: "content-mixed",
      title: "Mixed signals: title, H1 and URL disagree",
      severity: "info",
      description: "On these pages the title, main heading and URL don't share a meaningful word, so it's less clear what the page is about.",
      why: "The title, H1 and URL are the strongest clues to a page's topic. When they point in different directions the page sends a weaker signal for any one phrase. Sometimes deliberate — a punchy H1 with a descriptive title.",
      how: "Make sure the page's main phrase appears in the title and the H1, and ideally the URL. Changing a live URL needs a 301 redirect from the old one, so start with the title and H1.",
      rows: mixed.map((p) => ({ label: p.title ?? p.url, url: p.url, note: p.mixed ?? undefined })),
    });
  }
  return out;
}

export function contentSummary(model: ContentModel): { warnings: number; notices: number } {
  let warnings = 0;
  let notices = 0;
  for (const f of model.findings) {
    if (f.severity === "warning") warnings += f.rows.length;
    else notices += f.rows.length;
  }
  return { warnings, notices };
}
