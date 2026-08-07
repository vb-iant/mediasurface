// Blog post detail — reference implementation, see page.tsx and
// CLAUDE.md "Velocity B blog front-end migration" for context.
//
// Decision made here (was an open question in earlier planning): a direct
// URL to a draft post 404s, same as a nonexistent slug. Simpler and safer
// default than "reachable but unlisted" — a draft isn't publicly visible
// by any path until it's published. Admin preview of drafts (seeing a
// draft before publishing) is a different, separate feature for inside
// the gated admin UI, not this public route.

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

  let post;
  try {
    post = await getPost("velocity-b", slug);
  } catch (err) {
    if (err instanceof GitHubNotFoundError) notFound();
    throw err;
  }

  if (post.status === "draft") {
    notFound();
  }

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
