// Blog index — reference implementation for how blog listing should work
// across all sites, built and owned in mediasurface. See CLAUDE.md
// "Velocity B blog front-end migration": velocity-b's own code is
// reference-only during this build, not touched — it migrates onto this
// implementation once proven, as a deliberate cutover.
//
// Reads LIVE via the storage interface against mediasurface's own
// content/blog (site "mediasurface" in site-config.ts) — mediasurface is a
// real, admin-editable test/sandbox site now, not a static fixture. New
// schema fields and display logic get built and tested here, editor UI
// included, before being ported to the other sites. Dynamic/per-request
// rendering — no build required to see a content change take effect,
// though a push via the admin still triggers a Vercel redeploy of this
// app anyway (same repo).
//
// Draft filtering happens HERE, not in the shared storage interface —
// listPosts() returns everything (the admin's post-list view needs drafts
// too), so this route applies its own "published only" filter, same as
// production sites will need to.

import Link from "next/link";
import { listPosts } from "@/lib/storage/posts";
import type { PostSummary } from "@/lib/storage/schema";

export const dynamic = "force-dynamic";

function normalizeAuthorLabel(author: string | string[]): string {
  return Array.isArray(author) ? author.join(", ") : author;
}

function isPublished(post: PostSummary): boolean {
  return post.status !== "draft";
}

export default async function BlogIndexPage() {
  const allPosts = await listPosts("mediasurface");
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
