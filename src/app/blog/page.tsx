// Public test blog index — see CLAUDE.md "Velocity B blog front-end
// migration" and the tracking task (tm-1786121459881) for full scope.
//
// Deliberately public (not behind the admin's auth gate, once that
// exists) and unlinked from mediasurface's own nav.
//
// Wired to real Velocity B content via the storage interface. No
// draft-filtering yet — that's built next, proven here, then ported to
// velocity-b's own repo. For now this lists every post exactly as
// listPosts() returns it (drafts included), so treat this stage as
// "content loads correctly," not yet "matches intended public behavior."

import Link from "next/link";
import { listPosts } from "@/lib/storage/posts";

// Render per-request, not at mediasurface's own build time. Content lives
// in a separate repo (velocity-b) and changes independently of this app's
// deploys — static generation here would silently go stale the moment a
// post is edited via the admin without mediasurface itself being rebuilt.
export const dynamic = "force-dynamic";

export default async function BlogIndexPage() {
  const posts = await listPosts("velocity-b");

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>Blog</h1>
      {posts.length === 0 ? (
        <p>No posts yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {posts.map((post) => (
            <li key={post.slug} style={{ marginBottom: "1.5rem" }}>
              <Link href={`/blog/${post.slug}`}>
                <strong>{post.title}</strong>
              </Link>
              <div style={{ fontSize: "0.875rem", color: "#666" }}>
                {post.date} · {normalizeAuthorLabel(post.author)}
                {post.status === "draft" ? " · DRAFT" : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function normalizeAuthorLabel(author: string | string[]): string {
  return Array.isArray(author) ? author.join(", ") : author;
}

