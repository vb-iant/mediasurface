// Shared author-byline renderer — a post's `author` field is a slug (or
// array of slugs) into the Author entity (content/authors/*.md), not a
// display name. Resolves via getAuthorBySlug and links to
// /blog/author/[slug], falling back to the raw slug (unlinked) if no
// profile matches. Extracted here so the index, paginated index, and post
// detail routes share one implementation instead of three copies.

import Link from "next/link";
import { getAuthorBySlug } from "@/lib/blog/local-authors";
import { normalizeAuthors } from "@/lib/storage/schema";
import type { Author } from "@/lib/storage/schema";

export function AuthorByline({ author }: { author: string | string[] }) {
  const slugs = normalizeAuthors(author);
  return (
    <>
      {slugs.map((slug, i) => {
        const resolved: Author | null = getAuthorBySlug(slug);
        return (
          <span key={slug}>
            {i > 0 && ", "}
            {resolved ? (
              <Link href={`/blog/author/${resolved.slug}`}>{resolved.name}</Link>
            ) : (
              slug
            )}
          </span>
        );
      })}
    </>
  );
}
