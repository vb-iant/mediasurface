/**
 * Search for the admin post list (/admin/posts). Deliberately separate
 * from src/lib/blog/search.ts (the public blog's search): that module
 * resolves tags/authors to display names via getAllTags()/getAllAuthors(),
 * which read mediasurface's own local content — correct for the public
 * /blog reference implementation, but wrong here, since the admin's post
 * list comes from listPosts(siteId) via the storage interface and can be
 * showing Velocity B, Rockstar CMO, etc. Per-site tag/author name
 * resolution isn't wired up site-agnostically yet (only Velocity B has a
 * real site-config entry), so this searches the raw fields already present
 * on PostSummary — title, excerpt, tag slugs, author slug(s) — rather than
 * resolved names. Revisit once/if per-site tag/author lookups exist.
 */

import Fuse from "fuse.js";
import type { PostSummary } from "@/lib/storage/schema";
import { normalizeAuthors } from "@/lib/storage/schema";

interface SearchableRecord {
  post: PostSummary;
  title: string;
  excerpt: string;
  tags: string;
  author: string;
}

function buildSearchableRecords(posts: PostSummary[]): SearchableRecord[] {
  return posts.map((post) => ({
    post,
    title: post.title,
    excerpt: post.excerpt ?? "",
    tags: (post.tags ?? []).join(" "),
    author: normalizeAuthors(post.author).join(" "),
  }));
}

// Same weighting rationale as the public blog's search.ts: title is the
// field an editor is most likely searching by intent.
const FUSE_OPTIONS: ConstructorParameters<typeof Fuse<SearchableRecord>>[1] = {
  keys: [
    { name: "title", weight: 0.5 },
    { name: "excerpt", weight: 0.25 },
    { name: "tags", weight: 0.15 },
    { name: "author", weight: 0.1 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
};

/**
 * Fuzzy-searches `posts` by `query`, returning matches ranked best-first.
 * Returns `posts` unchanged if `query` is empty/blank.
 */
export function searchAdminPosts(posts: PostSummary[], query: string | undefined): PostSummary[] {
  const trimmed = query?.trim();
  if (!trimmed) return posts;

  const records = buildSearchableRecords(posts);
  const fuse = new Fuse(records, FUSE_OPTIONS);
  return fuse.search(trimmed).map((result) => result.item.post);
}
