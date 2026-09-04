// Blog post detail — reference implementation, see page.tsx and CLAUDE.md
// "Velocity B blog front-end migration" for context.
//
// Statically generated via generateStaticParams, reading content/blog off
// the local filesystem — same reasoning as the index route. No GitHub API
// call, no GITHUB_TOKEN dependency.
//
// A direct URL to a draft's slug 404s, same as a nonexistent slug —
// simpler and safer default than "reachable but unlisted." Admin preview
// of drafts is a different, separate feature inside the gated admin UI.
//
// Author byline: same resolution/fallback pattern as the index page (see
// page.tsx) — a post's `author` field is a slug into the Author entity,
// resolved and linked to /blog/author/[slug], falling back to the raw
// slug, unlinked, if no profile matches.

import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { getLocalPost, getLocalPublishedSlugs } from "@/lib/blog/local-content";
import { getAuthorBySlug } from "@/lib/blog/local-authors";
import { getPrimaryTag, getResolvedTags } from "@/lib/blog/local-tags";
import { normalizeAuthors } from "@/lib/storage/schema";
import type { Author } from "@/lib/storage/schema";

// Tag pills are display-only for now — see page.tsx for why (?tag=
// filtering needs the pagination component, tm-1788532452755, not built
// yet). Full tag list still renders at the bottom so the entity/rendering
// work is genuinely done, just not clickable-to-filter yet.

function AuthorByline({ author }: { author: string | string[] }) {
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

export function generateStaticParams() {
  return getLocalPublishedSlugs().map((slug) => ({ slug }));
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getLocalPost(slug);

  if (!post) notFound();

  const primaryTag = getPrimaryTag(post.tags);
  const allTags = getResolvedTags(post.tags);

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <p style={{ marginBottom: "1.5rem" }}>
        <Link href="/blog">&larr; Back to blog</Link>
      </p>
      {primaryTag && (
        <span
          style={{
            display: "inline-block",
            fontSize: "0.75rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "#0055cc",
            border: "1px solid #0055cc",
            borderRadius: "999px",
            padding: "0.15rem 0.65rem",
            marginBottom: "0.75rem",
          }}
        >
          {primaryTag.name}
        </span>
      )}
      <h1 style={{ marginBottom: "0.5rem" }}>{post.title}</h1>
      <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "2rem" }}>
        {post.date} · <AuthorByline author={post.author} /> · {post.readingTime}
      </div>
      <article style={{ lineHeight: 1.7 }}>
        <ReactMarkdown>{post.body}</ReactMarkdown>
      </article>
      {allTags.length > 0 && (
        <div style={{ marginTop: "2rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {allTags.map((tag) => (
            <span
              key={tag.id}
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#42465c",
                border: "1px solid #e5e5e5",
                borderRadius: "999px",
                padding: "0.25rem 0.75rem",
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </main>
  );
}
