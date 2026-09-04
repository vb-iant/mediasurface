/**
 * Local filesystem loader for tags — reference implementation.
 *
 * Same reasoning as local-content.ts/local-authors.ts: content/tags.json
 * is checked into THIS repo, already on disk at build time. Mirrors
 * Velocity B's lib/blog.ts getAllTags()/getTagBySlug() (a flat JSON array,
 * unlike authors which are one file per author).
 *
 * A post's `tags` field is an array of slugs into this entity — resolve
 * here before rendering a tag's display name.
 */

import fs from "fs";
import path from "path";
import type { Tag } from "@/lib/storage/schema";

const TAGS_PATH = path.join(process.cwd(), "content/tags.json");

let tagsCache: Tag[] | null = null;

export function getAllTags(): Tag[] {
  if (tagsCache) return tagsCache;
  if (!fs.existsSync(TAGS_PATH)) {
    tagsCache = [];
    return tagsCache;
  }
  tagsCache = JSON.parse(fs.readFileSync(TAGS_PATH, "utf-8")) as Tag[];
  return tagsCache;
}

export function getTagBySlug(slug: string): Tag | null {
  return getAllTags().find((t) => t.slug === slug) ?? null;
}

/** The post's first tag, resolved to a Tag entity, or null if it has no
 * tags or its first tag slug doesn't match a known Tag. Mirrors Velocity
 * B's "primaryTag" convention used for the single pill shown on post
 * cards and the post detail hero — not every tag, just the first. */
export function getPrimaryTag(tagSlugs: string[] | undefined): Tag | null {
  const firstSlug = tagSlugs?.[0];
  return firstSlug ? getTagBySlug(firstSlug) : null;
}

/** All of a post's tags, resolved to Tag entities. Unresolvable slugs
 * (no matching content/tags.json entry) are silently dropped rather than
 * rendered as raw slugs — unlike author fallback, an unresolvable tag has
 * no display name to fall back to. */
export function getResolvedTags(tagSlugs: string[] | undefined): Tag[] {
  if (!tagSlugs) return [];
  const all = getAllTags();
  return tagSlugs
    .map((slug) => all.find((t) => t.slug === slug))
    .filter((t): t is Tag => Boolean(t));
}
