/**
 * Local filesystem content loader for the /blog reference implementation.
 *
 * Deliberately does NOT go through the storage interface
 * (src/lib/storage/posts.ts) or the GitHub API. content/blog is checked
 * into THIS repo — the same repo this app builds from — so it's already
 * on disk at build time, exactly like how velocity-b's own deployed site
 * will read its own content once migrated onto this implementation. No
 * GITHUB_TOKEN, no network call, no runtime dependency of any kind for a
 * route that's public (not behind the admin's password gate).
 *
 * The storage interface (GitHub API) is still what the admin's editor
 * uses to WRITE content here (and to read/write any other site's repo
 * remotely, which genuinely does need the API — that's cross-repo access,
 * a fundamentally different case from a repo reading its own files).
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";
import type { Post, PostFrontmatter, PostSummary } from "@/lib/storage/schema";

const CONTENT_DIR = path.join(process.cwd(), "content/blog");

function isPublished(post: PostSummary): boolean {
  return post.status !== "draft";
}

function readAllContentFiles(): { slug: string; raw: string }[] {
  const filenames = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  return filenames.map((filename) => ({
    slug: filename.replace(/\.md$/, ""),
    raw: fs.readFileSync(path.join(CONTENT_DIR, filename), "utf-8"),
  }));
}

/** All published posts, newest first. Drafts excluded. */
export function getLocalPosts(): PostSummary[] {
  const files = readAllContentFiles();
  const summaries: PostSummary[] = files.map(({ slug, raw }) => {
    const { data } = matter(raw);
    const frontmatter = data as PostFrontmatter;
    return {
      ...frontmatter,
      slug: frontmatter.slug || slug,
      path: `content/blog/${slug}.md`,
    };
  });

  return summaries
    .filter(isPublished)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** A single post by slug. Returns null if not found OR if it's a draft —
 * drafts are not reachable via direct URL on the public reference blog. */
export function getLocalPost(slug: string): Post | null {
  const filePath = path.join(CONTENT_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content: body } = matter(raw);
  const frontmatter = data as PostFrontmatter;

  if (frontmatter.status === "draft") return null;

  return {
    ...frontmatter,
    slug: frontmatter.slug || slug,
    path: `content/blog/${slug}.md`,
    body,
    readingTime: readingTime(body).text,
  };
}

/** All slugs, published only — for generateStaticParams. */
export function getLocalPublishedSlugs(): string[] {
  return getLocalPosts().map((p) => p.slug);
}
