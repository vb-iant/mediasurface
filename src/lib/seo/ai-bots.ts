/**
 * AI crawlers the audit reports on. This landscape changes — update here.
 * Checked against each vendor's own docs on 2026-10-11:
 * - OpenAI: developers.openai.com/docs/bots
 * - Anthropic: support.claude.com/en/articles/8896518-what-is-claude-bot
 * - Perplexity: docs.perplexity.ai/docs/resources/perplexity-crawlers
 * Google-Extended / Applebot-Extended are robots.txt control tokens, not
 * separate crawlers: they govern use of content for AI models.
 *
 * Groups (Ian's decision, 2026-10-11): blocking "search" or "user" bots
 * raises ONE warning — being cited in AI answers is a traffic source, so
 * blocking them is usually a mistake. "training" bots are neutral info:
 * opting out of model training is a legitimate choice.
 */

export type AiBotGroup = "search" | "user" | "training";

export interface AiBot {
  token: string;
  vendor: string;
  group: AiBotGroup;
  purpose: string;
  /** The vendor says this fetcher may not obey robots.txt. */
  mayIgnoreRobots?: boolean;
}

export const AI_BOTS: AiBot[] = [
  { token: "OAI-SearchBot", vendor: "OpenAI", group: "search", purpose: "ChatGPT search results" },
  { token: "Claude-SearchBot", vendor: "Anthropic", group: "search", purpose: "Claude search results" },
  { token: "PerplexityBot", vendor: "Perplexity", group: "search", purpose: "Perplexity search results" },
  { token: "ChatGPT-User", vendor: "OpenAI", group: "user", purpose: "Pages ChatGPT opens for a user", mayIgnoreRobots: true },
  { token: "Claude-User", vendor: "Anthropic", group: "user", purpose: "Pages Claude opens for a user" },
  { token: "Perplexity-User", vendor: "Perplexity", group: "user", purpose: "Pages Perplexity opens for a user", mayIgnoreRobots: true },
  { token: "GPTBot", vendor: "OpenAI", group: "training", purpose: "Model training" },
  { token: "ClaudeBot", vendor: "Anthropic", group: "training", purpose: "Model training" },
  { token: "Google-Extended", vendor: "Google", group: "training", purpose: "Gemini training and grounding" },
  { token: "Applebot-Extended", vendor: "Apple", group: "training", purpose: "Apple Intelligence training" },
  { token: "CCBot", vendor: "Common Crawl", group: "training", purpose: "Open dataset used for training" },
  { token: "Meta-ExternalAgent", vendor: "Meta", group: "training", purpose: "Model training" },
  { token: "Bytespider", vendor: "ByteDance", group: "training", purpose: "Model training" },
];

export const AI_GROUP_LABELS: Record<AiBotGroup, string> = {
  search: "AI search",
  user: "Fetches for a user",
  training: "Training",
};
