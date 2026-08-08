// Blog index — this is the reference implementation for how blog listing
// should work across all sites, built and owned in mediasurface. See
// CLAUDE.md "Velocity B blog front-end migration": velocity-b's own code
// is reference-only during this build, not touched — it migrates onto
// this implementation once proven, as a deliberate cutover.
//
// Renders LOCAL FIXTURE content (src/content/blog/*.md), not live GitHub
// content. Deliberate: this route's job is to prove the rendering logic
// (draft filtering, Markdown rendering, layout) works, which doesn't
// require a live remote content source — and a live GitHub dependency
// here wouldn't even match production, since velocity-b (once migrated)
// reads its own content from local files, exactly like this does with
// fixtures. Statically generated at build time, same as production.
//
// The ADMIN (not this route) is what genuinely needs live GitHub access,
// via src/lib/storage/posts.ts — that's a real, separate requirement.

import Link from "next/link";
import { getLocalPosts } from "@/lib/blog/local-content";
import type { PostSummary } from "@/lib/storage/schema";

function normalizeAuthorLabel(author: string | string[]): string {
  return Array.isArray(author) ? author.join(", ") : author;
}

export default function BlogIndexPage() {
  const posts: PostSummary[] = getLocalPosts();

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
