/**
 * Local content loader for the blog reference implementation
 * (src/app/blog). Deliberately does NOT use the storage interface
 * (src/lib/storage/posts.ts) — that's for the admin, which genuinely
 * needs live cross-repo GitHub access to read/write real site content.
 *
 * The reference implementation's job is to prove the *rendering logic*
 * (draft filtering, Markdown rendering, layout) works — it doesn't need
 * a live remote content source to do that, and coupling it to one added
 * an unnecessary runtime dependency (GITHUB_TOKEN) that doesn't even
 * match what production will actually do: once velocity-b migrates onto
 * this implementation, it reads its own content from local files in its
 * own repo, exactly like this loader does with fixture content now.
 *
 * Fixture posts live in src/content/blog/*.md — sample content shaped
 * like real Velocity B frontmatter, not real posts.
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";
import type { Post, PostFrontmatter, PostSummary } from "@/lib/storage/schema";

const CONTENT_DIR = path.join(process.cwd(), "src/content/blog");

function isPublished(post: PostSummary): boolean {
  return post.status !== "draft";
}

function readAllFixtureFiles(): { slug: string; raw: string }[] {
  const filenames = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  return filenames.map((filename) => ({
    slug: filename.replace(/\.md$/, ""),
    raw: fs.readFileSync(path.join(CONTENT_DIR, filename), "utf-8"),
  }));
}

/** All published posts, newest first. Drafts excluded. */
export function getLocalPosts(): PostSummary[] {
  const files = readAllFixtureFiles();
  const summaries: PostSummary[] = files.map(({ slug, raw }) => {
    const { data } = matter(raw);
    const frontmatter = data as PostFrontmatter;
    return {
      ...frontmatter,
      slug: frontmatter.slug || slug,
      path: `src/content/blog/${slug}.md`,
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
    path: `src/content/blog/${slug}.md`,
    body,
    readingTime: readingTime(body).text,
  };
}

/** All slugs, published only — for generateStaticParams. */
export function getLocalPublishedSlugs(): string[] {
  return getLocalPosts().map((p) => p.slug);
}
