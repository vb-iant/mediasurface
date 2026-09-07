/**
 * Blog search — server-side, using the same searchParams pattern already
 * established for tag filtering (see components/blog/BlogIndexContent.tsx).
 *
 * Deliberately NOT a client-side/as-you-type implementation: this runs
 * Fuse.js over the post list that's already loaded server-side by
 * getLocalPosts() for every request, the same way tag filtering already
 * does. No JSON index is generated or shipped to the browser, no client
 * component is introduced — a GET form submits `?q=`, exactly like tag
 * pills already submit `?tag=` via plain links. Chosen over a client-side
 * index specifically to match the zero-client-JS precedent already set by
 * tag filtering, rather than introducing a second, inconsistent pattern.
 *
 * Portability note: this file is intentionally self-contained (only
 * depends on schema types + local-tags/local-authors resolution) so it can
 * be copied into a site's own repo on cutover the same way local-content.ts
 * and the OG config already are — "shared pattern, per-site copy", not a
 * runtime package import across repos.
 */

import Fuse from "fuse.js";
import type { PostSummary } from "@/lib/storage/schema";
import { getAllTags } from "@/lib/blog/local-tags";
import { getAllAuthors } from "@/lib/blog/local-authors";
import { normalizeAuthors } from "@/lib/storage/schema";

interface SearchableRecord {
  post: PostSummary;
  title: string;
  excerpt: string;
  tagNames: string;
  authorNames: string;
}

function buildSearchableRecords(posts: PostSummary[]): SearchableRecord[] {
  const tagsBySlug = new Map(getAllTags().map((t) => [t.slug, t.name]));
  const authorsBySlug = new Map(getAllAuthors().map((a) => [a.slug, a.name]));

  return posts.map((post) => ({
    post,
    title: post.title,
    excerpt: post.excerpt ?? "",
    tagNames: (post.tags ?? []).map((slug) => tagsBySlug.get(slug) ?? slug).join(" "),
    authorNames: normalizeAuthors(post.author)
      .map((slug) => authorsBySlug.get(slug) ?? slug)
      .join(" "),
  }));
}

// Weighted so a title match ranks above an excerpt/tag/author match —
// title is the field a reader is most likely searching by intent.
const FUSE_OPTIONS: ConstructorParameters<typeof Fuse<SearchableRecord>>[1] = {
  keys: [
    { name: "title", weight: 0.5 },
    { name: "excerpt", weight: 0.25 },
    { name: "tagNames", weight: 0.15 },
    { name: "authorNames", weight: 0.1 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
};

/**
 * Fuzzy-searches `posts` by `query`, returning matches ranked best-first.
 * Returns `posts` unchanged (in existing order) if `query` is empty/blank —
 * callers don't need to special-case "no search active".
 */
export function searchPosts(posts: PostSummary[], query: string | undefined): PostSummary[] {
  const trimmed = query?.trim();
  if (!trimmed) return posts;

  const records = buildSearchableRecords(posts);
  const fuse = new Fuse(records, FUSE_OPTIONS);
  return fuse.search(trimmed).map((result) => result.item.post);
}
