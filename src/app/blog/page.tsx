// Blog index — reference implementation for how blog listing should work
// across all sites, built and owned in mediasurface. See CLAUDE.md
// "Velocity B blog front-end migration": velocity-b's own code is
// reference-only during this build, not touched — it migrates onto this
// implementation once proven, as a deliberate cutover.
//
// Reads content/blog directly off the local filesystem, statically
// generated at build time — the same pattern velocity-b's own deployed
// site will use once migrated: a repo's own front-end reads its own
// already-checked-out content, no GitHub API call needed. content/blog is
// real, admin-editable content (the admin writes to it via the storage
// interface/GitHub API — cross-repo write access genuinely needs that),
// but THIS route, reading its own repo's own files, doesn't. Zero
// GITHUB_TOKEN dependency on a route that's public, not behind the gate.
//
// Draft filtering happens in the local-content loader — listPosts() via
// the storage interface (used by the admin's post-list view) returns
// everything, drafts included, since the admin needs to see and edit
// those too.

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
