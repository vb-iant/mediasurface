/**
 * Shapes shared by every check. Findings are derived from an AuditResult and
 * never stored (see findings.ts), so these can change freely.
 */

export type Severity = "error" | "warning" | "info";

/** Groups findings in the report. */
export type Category = "status" | "sitemap" | "onpage";

export const CATEGORY_LABELS: Record<Category, string> = {
  status: "Status & redirects",
  sitemap: "Sitemap & robots.txt",
  onpage: "On-page SEO",
};

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  description: string;
  urls: string[];
  /** Optional short note per URL, shown beside it (e.g. "72 characters"). */
  notes?: Record<string, string>;
  /** Set when the result can't be fully trusted (e.g. page limit reached). */
  caveat?: string;
}
