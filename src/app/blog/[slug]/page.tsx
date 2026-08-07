// Public test blog post detail — see CLAUDE.md "Velocity B blog front-end
// migration" and the tracking task (tm-1786121459881) for full scope.
//
// Wired to real Velocity B content via getPost(). No draft-gating yet —
// a direct URL to a draft slug currently renders it, same as a published
// one. That's an open question this task itself needs to resolve (does a
// direct draft URL 404, or stay reachable-but-unlisted?) before porting
// to velocity-b's own repo.

import { notFound } from "next/navigation";
import { getPost } from "@/lib/storage/posts";
import { GitHubNotFoundError } from "@/lib/github/client";

// Same reasoning as the index route — render per-request, not at
// mediasurface's own build time.
export const dynamic = "force-dynamic";

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

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      {post.status === "draft" && (
        <div style={{ background: "#fff3cd", padding: "0.5rem 1rem", marginBottom: "1.5rem" }}>
          DRAFT — not yet decided whether this should be reachable at this URL.
        </div>
      )}
      <h1>{post.title}</h1>
      <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1.5rem" }}>
        {post.date} · {normalizeAuthorLabel(post.author)} · {post.readingTime}
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{post.body}</div>
    </main>
  );
}

function normalizeAuthorLabel(author: string | string[]): string {
  return Array.isArray(author) ? author.join(", ") : author;
}

