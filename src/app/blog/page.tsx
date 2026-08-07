// Blog index — this is the reference implementation for how blog listing
// should work across all sites, built and owned in mediasurface. See
// CLAUDE.md "Velocity B blog front-end migration": velocity-b's own code
// is reference-only during this build, not touched — it migrates onto
// this implementation once proven, as a deliberate cutover.
//
// Renders real Velocity B content via the storage interface. Dynamic
// (not statically generated at mediasurface's own build time) since
// content lives in a separate repo and changes independently of this
// app's deploys.

import Link from "next/link";
import { listPosts } from "@/lib/storage/posts";
import type { PostSummary } from "@/lib/storage/schema";

export const dynamic = "force-dynamic";

function normalizeAuthorLabel(author: string | string[]): string {
  return Array.isArray(author) ? author.join(", ") : author;
}

// Draft/published filtering lives here — the behavior velocity-b's own
// code currently lacks entirely. A post with no status field is treated
// as published (matches all 37 real posts, none of which set this field
// yet), so onboarding this filter never silently hides existing content.
function isPublished(post: PostSummary): boolean {
  return post.status !== "draft";
}

export default async function BlogIndexPage() {
  const allPosts = await listPosts("velocity-b");
  const posts = allPosts.filter(isPublished);

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginBottom: "2rem" }}>Blog</h1>
      {posts.length === 0 ? (
        <p>No posts yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {posts.map((post) => (
            <li
              key={post.slug}
              style={{
                marginBottom: "2rem",
                paddingBottom: "2rem",
                borderBottom: "1px solid #e5e5e5",
              }}
            >
              <h2 style={{ marginBottom: "0.25rem" }}>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
              </h2>
              <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
                {post.date} · {normalizeAuthorLabel(post.author)}
              </div>
              {post.excerpt && <p style={{ margin: 0 }}>{post.excerpt}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
