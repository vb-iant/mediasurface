/**
 * Local filesystem loader for author profiles — reference implementation.
 *
 * Same reasoning as local-content.ts: content/authors is checked into THIS
 * repo, already on disk at build time, so this reads fs directly rather
 * than going through the storage interface/GitHub API. Mirrors Velocity
 * B's lib/blog.ts getAllAuthors()/getAuthorBySlug()/getPostsByAuthor()
 * (content/authors/*.md — frontmatter is everything but bio, bio is the
 * markdown body).
 *
 * A post's `author` field is a slug (or array of slugs, see
 * normalizeAuthors) into this entity — resolve it here before rendering a
 * name, avatar, or link. Multi-author UI (linking more than one author in
 * a byline) is schema-supported via normalizeAuthors but not a decided
 * feature yet — see tm-1786120853654 (backlogged 2026-09-04). This loader
 * itself is author-count-agnostic; it doesn't assume single vs. multi.
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { Author, PostSummary } from "@/lib/storage/schema";
import { normalizeAuthors } from "@/lib/storage/schema";
import { getLocalPosts } from "@/lib/blog/local-content";

const AUTHORS_DIR = path.join(process.cwd(), "content/authors");

let authorCache: Record<string, Author> | null = null;

function readAllAuthors(): Record<string, Author> {
  if (authorCache) return authorCache;

  const result: Record<string, Author> = {};
  if (fs.existsSync(AUTHORS_DIR)) {
    const filenames = fs.readdirSync(AUTHORS_DIR).filter((f) => f.endsWith(".md"));
    for (const filename of filenames) {
      const raw = fs.readFileSync(path.join(AUTHORS_DIR, filename), "utf-8");
      const { data, content } = matter(raw);
      const frontmatter = data as Omit<Author, "bio">;
      const slug = frontmatter.slug || filename.replace(/\.md$/, "");
      result[slug] = { ...frontmatter, slug, bio: content.trim() };
    }
  }

  authorCache = result;
  return result;
}

/** All author profiles that exist, regardless of whether they have posts. */
export function getAllAuthors(): Author[] {
  return Object.values(readAllAuthors());
}

export function getAuthorBySlug(slug: string): Author | null {
  return readAllAuthors()[slug] ?? null;
}

/** Published posts by a given author slug, newest first. Matches via
 * normalizeAuthors so this works whether a post's `author` field is a
 * single string or an array. */
export function getPostsByAuthor(authorSlug: string): PostSummary[] {
  return getLocalPosts().filter((post) =>
    normalizeAuthors(post.author).includes(authorSlug)
  );
}

/** Author slugs that both (a) have a profile file and (b) have at least
 * one published post — for generateStaticParams. Avoids generating an
 * archive page for a profile with zero posts, or a slug with posts but no
 * matching profile (nothing to render). */
export function getLocalAuthorSlugsWithPosts(): string[] {
  const authors = readAllAuthors();
  const slugsWithPosts = new Set<string>();

  for (const post of getLocalPosts()) {
    for (const slug of normalizeAuthors(post.author)) {
      if (authors[slug]) slugsWithPosts.add(slug);
    }
  }

  return Array.from(slugsWithPosts);
}
