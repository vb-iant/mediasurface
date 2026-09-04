// Shared author-byline renderer — a post's `author` field is a slug (or
// array of slugs) into the Author entity (content/authors/*.md), not a
// display name. Resolves via getAuthorBySlug and links to
// /blog/author/[slug], falling back to the raw slug (unlinked) if no
// profile matches. Extracted here so the index, paginated index, and post
// detail routes share one implementation instead of three copies.
//
// Now includes a small avatar (photo or initials fallback via
// AuthorAvatar) before each author's name, on by default — every
// existing call site picks this up automatically without needing its own
// changes, since none of them passed avatar-related props before this
// existed.

import Link from "next/link";
import { getAuthorBySlug } from "@/lib/blog/local-authors";
import { normalizeAuthors } from "@/lib/storage/schema";
import type { Author } from "@/lib/storage/schema";
import { AuthorAvatar } from "@/components/blog/AuthorAvatar";

export function AuthorByline({
  author,
  showAvatar = true,
  avatarSize = 20,
}: {
  author: string | string[];
  showAvatar?: boolean;
  avatarSize?: number;
}) {
  const slugs = normalizeAuthors(author);
  return (
    <>
      {slugs.map((slug, i) => {
        const resolved: Author | null = getAuthorBySlug(slug);
        return (
          <span key={slug} className="inline-flex items-center gap-1.5 align-middle">
            {i > 0 && <span>,&nbsp;</span>}
            {showAvatar && <AuthorAvatar author={resolved} size={avatarSize} />}
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
