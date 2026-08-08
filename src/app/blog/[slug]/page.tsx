// Blog post detail — reference implementation, see page.tsx and CLAUDE.md
// "Velocity B blog front-end migration" for context.
//
// Reads LIVE via the storage interface against mediasurface's own
// content/blog — same reasoning as the index route. Dynamic/per-request,
// no generateStaticParams (a build isn't required to see a new/edited
// post appear).
//
// A direct URL to a draft's slug 404s, same as a nonexistent slug —
// simpler and safer default than "reachable but unlisted." Admin preview
// of drafts is a different, separate feature inside the gated admin UI.

import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { getPost } from "@/lib/storage/posts";
import { GitHubNotFoundError } from "@/lib/github/client";

export const dynamic = "force-dynamic";

function normalizeAuthorLabel(author: string | string[]): string {
  return Array.isArray(author) ? author.join(", ") : author;
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const post = await getPost("mediasurface", slug).catch((err) => {
    if (err instanceof GitHubNotFoundError) return null;
    throw err;
  });

  if (!post || post.status === "draft") notFound();

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
