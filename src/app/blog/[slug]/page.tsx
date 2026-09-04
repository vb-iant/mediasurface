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
// Author byline uses the shared components/blog/AuthorByline.tsx (also
// used by the index/paginated routes) rather than a local copy.
//
// Tag list at the bottom now LINKS to /blog?tag=slug — pagination
// (tm-1788532452755) built the filtering this depends on, so what was a
// display-only pill when tags first shipped (tm-1788532439986) is now
// functional, matching Velocity B's own post-detail tag links.

import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { getLocalPost, getLocalPublishedSlugs } from "@/lib/blog/local-content";
import { getPrimaryTag, getResolvedTags } from "@/lib/blog/local-tags";
import { AuthorByline } from "@/components/blog/AuthorByline";

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
            <Link
              key={tag.id}
              href={`/blog?tag=${tag.slug}`}
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#42465c",
                border: "1px solid #e5e5e5",
                borderRadius: "999px",
                padding: "0.25rem 0.75rem",
                textDecoration: "none",
              }}
            >
              {tag.name}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
