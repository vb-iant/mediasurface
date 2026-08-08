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

import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { getLocalPost, getLocalPublishedSlugs } from "@/lib/blog/local-content";

function normalizeAuthorLabel(author: string | string[]): string {
  return Array.isArray(author) ? author.join(", ") : author;
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

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <p style={{ marginBottom: "1.5rem" }}>
        <Link href="/blog">&larr; Back to blog</Link>
      </p>
      <h1 style={{ marginBottom: "0.5rem" }}>{post.title}</h1>
      <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "2rem" }}>
        {post.date} · {normalizeAuthorLabel(post.author)} · {post.readingTime}
      </div>
      <article style={{ lineHeight: 1.7 }}>
        <ReactMarkdown>{post.body}</ReactMarkdown>
      </article>
    </main>
  );
}
