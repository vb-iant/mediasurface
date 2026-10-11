/**
 * Shapes shared by every check. Findings are derived from an AuditResult and
 * never stored (see findings.ts), so these can change freely.
 */

export type Severity = "error" | "warning" | "info";

/** Groups findings in the report. The order of CATEGORY_LABELS is the report order. */
export type Category =
  | "links"
  | "status"
  | "sitemap"
  | "structure"
  | "onpage"
  | "schema"
  | "performance"
  | "speed"
  | "ai";

export const CATEGORY_LABELS: Record<Category, string> = {
  links: "Links",
  status: "Status & redirects",
  sitemap: "Sitemap & robots.txt",
  structure: "Site structure",
  onpage: "On-page SEO",
  schema: "Structured data",
  performance: "Speed & weight",
  speed: "Page speed",
  ai: "AI crawlers",
};

export const CATEGORY_ORDER: Category[] = Object.keys(CATEGORY_LABELS) as Category[];

export interface LinkSource {
  page: string;
  text: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  description: string;
  urls: string[];
  /** Optional short note per URL, shown beside it (e.g. "72 characters"). */
  notes?: Record<string, string>;
  /** Pages that link to each URL, with the link text (capped per URL). */
  sources?: Record<string, LinkSource[]>;
  /** Set when the result can't be fully trusted (e.g. page limit reached). */
  caveat?: string;
}
