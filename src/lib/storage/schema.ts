/**
 * The one normalized blog schema shared across all sites (CLAUDE.md
 * decision #4). Pages are NOT covered here — page shapes differ more
 * per-site and stay on their own per-site schemas.
 *
 * `author` accepts a single slug or an array of slugs. Every post in
 * Velocity B's existing content currently uses a single string — the array
 * form is supported for forward compatibility ("multi-author-capable")
 * without requiring any existing content to change.
 */

export interface PostFrontmatter {
  title: string;
  slug: string;
  /** ISO date string, e.g. "2025-10-17". */
  date: string;
  author: string | string[];
  tags: string[];
  excerpt: string;
  featuredImage?: string;
  status?: "draft" | "published";
  seoTitle?: string;
  seoDescription?: string;
  /** Migration artifact on some Velocity B posts — not part of the core schema. */
  originalUrl?: string;
}

export interface PostSummary extends PostFrontmatter {
  /** File path within the repo, e.g. "content/blog/my-post.md". */
  path: string;
}

export interface Post extends PostSummary {
  body: string;
  /** Human-readable, e.g. "5 min read". Always computed, never stored. */
  readingTime: string;
}

export function normalizeAuthors(author: string | string[]): string[] {
  return Array.isArray(author) ? author : [author];
}

/** Slug -> filename convention used across all sites: `${slug}.md`. */
export function slugToFilename(slug: string): string {
  return `${slug}.md`;
}

export function filenameToSlug(filename: string): string {
  return filename.replace(/\.md$/, "");
}
