/**
 * robots.txt parsing and matching. Pure — the parser runs on the server
 * during discovery, the matcher runs in the browser crawler.
 *
 * Follows Google's documented behaviour (RFC 9309):
 * - pick the most specific user-agent group that names us, else `*`
 * - `*` wildcards and a trailing `$` anchor in paths
 * - longest matching rule wins; on a tie, Allow wins
 */

import type { RobotsGroupRule } from "./types";
import { USER_AGENT_TOKEN } from "./types";

export interface ParsedGroup {
  agents: string[];
  rules: RobotsGroupRule[];
  crawlDelay: number | null;
}

export interface ParsedRobots {
  sitemaps: string[];
  rules: RobotsGroupRule[];
  crawlDelay: number | null;
  /** Every group, so rules can be evaluated for other user agents too (AI crawler panel). */
  groups: ParsedGroup[];
}

/**
 * Pick the rules that apply to a user-agent token: groups that name it,
 * else the `*` group. `explicit` says whether the site named this agent.
 * Matching is case-insensitive on the product token ("GPTBot/1.1" → "gptbot").
 */
export function rulesFor(groups: ParsedGroup[], token: string): { rules: RobotsGroupRule[]; crawlDelay: number | null; explicit: boolean } {
  const t = token.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && a.split("/")[0].trim() === t));
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelay: chosen.find((g) => g.crawlDelay !== null)?.crawlDelay ?? null,
    explicit: named.length > 0,
  };
}

export function parseRobots(text: string): ParsedRobots {
  const groups: ParsedGroup[] = [];
  const sitemaps: string[] = [];
  let current: ParsedGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;

    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "allow everything" — no rule needed.
      if (value) current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  const ours = rulesFor(groups, USER_AGENT_TOKEN);
  return { sitemaps, rules: ours.rules, crawlDelay: ours.crawlDelay, groups };
}

function ruleToRegExp(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** True if robots.txt lets us crawl this URL. */
export function isAllowedByRobots(url: string, rules: RobotsGroupRule[]): boolean {
  if (rules.length === 0) return true;
  let target: string;
  try {
    const u = new URL(url);
    target = u.pathname + u.search;
  } catch {
    return true;
  }

  let best: RobotsGroupRule | null = null;
  for (const rule of rules) {
    if (!ruleToRegExp(rule.path).test(target)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
