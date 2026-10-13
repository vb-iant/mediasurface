/**
 * Text normalisation and phrase matching for the content scan (phase 6).
 *
 * Pure — no DOM, no cheerio — so the server extraction and the browser
 * model use exactly the same rules. English only (stop words, plural
 * folding); stated as a limit in the UI.
 *
 * Matching rules (Ian, 2026-10-12: "simple variants — plurals, word order,
 * hyphens"):
 * - lower-cased, accents stripped, apostrophes dropped ("client's" → "clients")
 * - hyphens, slashes and other punctuation split words ("b2b-marketing" → "b2b marketing")
 * - light plural folding ("forecasts" ~ "forecast", "agencies" ~ "agency")
 * - stop words ignored when matching a phrase ("tools for keyword research"
 *   matches "keyword research tools")
 * - word order ignored, within a window one word longer than the phrase
 */

/**
 * Common English function words and contractions. Deliberately no "web
 * boilerplate" words: "content", "home", "privacy", "page" are real topics
 * for some sites ("content strategy"). Site-wide boilerplate is caught by
 * how many pages a phrase appears on instead (model.ts).
 */
const STOP_WORDS = new Set(
  (
    "a about above after again against all also am an and any are aren as at be because been before being below " +
    "between both but by can cannot could did do does doing don down during each either etc even ever every few for " +
    "from further get gets got had has have having he her here hers herself him himself his how however i if in into " +
    "is isn it its itself just let lets like ll made make makes many may me might more most much must my myself " +
    "neither no nor not now of off often on once one only or other ought our ours ourselves out over own per rather " +
    "re really same say says see seen shall she should since so some such than that thats the their theirs them " +
    "themselves then there these they thing things this those though through thus to too under until up upon us " +
    "use used using ve very via was way ways we well were what whats when where whether which while who whom whose " +
    "why will with within without won would yes yet you your yours yourself yourselves " +
    // contractions (apostrophes are dropped before matching)
    "arent cant couldnt didnt doesnt dont hadnt hasnt havent hes id ill im isnt ive shes shouldnt theyll theyre " +
    "theyve wasnt weve werent whos wont wouldnt youd youll youre youve " +
    // verbs and fillers too generic to be a topic
    "come comes coming go goes going gone went need needs soon always never still already quite almost actually lot lots"
  ).split(" ")
);

const ARTICLES = new Set(["a", "an", "the", "this", "that", "these", "those", "your", "our", "my", "their", "its"]);

export function isStopWord(token: string): boolean {
  return STOP_WORDS.has(token);
}

/** Lower-case words, accents stripped, apostrophes dropped. Numbers kept. */
export function words(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’‘`]/g, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Light plural folding. Deliberately conservative: only plurals, nothing else. */
export function stem(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (/(?:ch|sh|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(?:ss|us|is|os|as)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** A word worth keeping as part of a phrase: not a stop word, not a lone letter or bare number. */
export function isContentWord(word: string): boolean {
  return word.length > 1 && !STOP_WORDS.has(word) && !/^\d+$/.test(word);
}

/** Stemmed content words of a text, in order (stop words dropped). */
export function contentTokens(text: string): string[] {
  return words(text).filter(isContentWord).map(stem);
}

/** Order-sensitive identity of a phrase ("Sales Forecasts" and "sales forecast" share one). */
export function phraseKey(text: string): string {
  return contentTokens(text).join(" ");
}

/** Order-insensitive identity: "forecasting sales" and "sales forecasting" share one. */
export function looseKey(text: string): string {
  return [...new Set(contentTokens(text))].sort().join(" ");
}

/**
 * Text split into runs that a phrase shouldn't span (sentences, list items,
 * headings). Each run is a list of words (unstemmed), stop words included —
 * n-grams need them as boundaries.
 */
export function segments(text: string): string[][] {
  return text
    .split(/[\n.!?;:|•·–—()[\]{}"“”]+/)
    .map(words)
    .filter((s) => s.length > 0);
}

/**
 * 1–3 word phrases in a run of words: no stop word at either end, no stop
 * word inside a two-word phrase ("sales and marketing" is allowed, "sales and"
 * isn't). Returned as [key, surface text].
 */
export function* ngrams(run: string[], max = 3): Generator<[string, string]> {
  for (let i = 0; i < run.length; i++) {
    if (!isContentWord(run[i])) continue;
    for (let n = 1; n <= max && i + n <= run.length; n++) {
      const last = run[i + n - 1];
      if (!isContentWord(last)) continue;
      const slice = run.slice(i, i + n);
      // "hitting the hiring" isn't a phrase; "sales and marketing", "art of winning" are.
      if (n === 3 && ARTICLES.has(slice[1])) continue;
      // Keys drop inner stop words, so "sales and marketing" ~ "sales marketing".
      const key = slice.filter(isContentWord).map(stem).join(" ");
      yield [key, slice.join(" ")];
    }
  }
}

/** The phrase as the user typed it, prepared for matching. Null if it has no content words. */
export interface TargetPhrase {
  /** As typed, tidied. */
  text: string;
  /** Unique stemmed content words, sorted (identity for de-duplication). */
  key: string;
  tokens: string[];
}

export function parseTarget(text: string): TargetPhrase | null {
  const tidy = text.replace(/\s+/g, " ").trim();
  const tokens = [...new Set(contentTokens(tidy))];
  if (!tidy || tokens.length === 0) return null;
  return { text: tidy, key: [...tokens].sort().join(" "), tokens };
}

/**
 * How many times a phrase occurs in a list of stemmed content tokens: every
 * phrase word inside a window one longer than the phrase, any order.
 * Matches don't overlap.
 */
export function countIn(tokens: string[], phrase: TargetPhrase): number {
  const need = phrase.tokens;
  if (need.length === 0 || tokens.length === 0) return 0;
  if (need.length === 1) return tokens.reduce((n, t) => n + (t === need[0] ? 1 : 0), 0);
  const window = need.length + 1;
  let count = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!need.includes(tokens[i])) continue;
    const seen = new Set<string>();
    let end = -1;
    for (let j = i; j < Math.min(tokens.length, i + window); j++) {
      if (need.includes(tokens[j])) seen.add(tokens[j]);
      if (seen.size === need.length) {
        end = j;
        break;
      }
    }
    if (end >= 0) {
      count++;
      i = end;
    }
  }
  return count;
}

/** Convenience: does the phrase appear in this text? */
export function appearsIn(text: string | null | undefined, phrase: TargetPhrase): boolean {
  return !!text && countIn(contentTokens(text), phrase) > 0;
}

/** Words of a URL's last path segment ("/blog/sales-forecasting-101/" → "sales forecasting 101"). */
export function slugText(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    return decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_+.]+/g, " ");
  } catch {
    return "";
  }
}
