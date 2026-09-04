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
//
// Author byline: a post's `author` field is a slug (or array of slugs)
// into the Author entity (content/authors/*.md), not a display name.
// Resolved via getAuthorBySlug and linked to /blog/author/[slug], mirroring
// Velocity B's PostCard.tsx. An unresolvable slug (no matching profile)
// falls back to showing the raw slug, unlinked, rather than hiding it.

import Link from "next/link";
import { getLocalPosts } from "@/lib/blog/local-content";
import { getAuthorBySlug } from "@/lib/blog/local-authors";
import { getPrimaryTag } from "@/lib/blog/local-tags";
import { normalizeAuthors } from "@/lib/storage/schema";
import type { PostSummary, Author } from "@/lib/storage/schema";

// Tag pills are display-only for now, not links — Velocity B's tag click
// filters the index via a ?tag= query param, which is wired together with
// its pagination component. mediasurface's index doesn't have pagination
// or query-param filtering yet (see tm-1788532452755), so a /blog?tag=
// link here would be dead. Revisit once pagination is built — Velocity B
// builds tag filtering and pagination as one component, worth doing the
// same here rather than wiring a plain link now and reworking it later.

function AuthorByline({ author }: { author: string | string[] }) {
  const slugs = normalizeAuthors(author);
  return (
    <>
      {slugs.map((slug, i) => {
        const resolved: Author | null = getAuthorBySlug(slug);
        return (
          <span key={slug}>
            {i > 0 && ", "}
            {resolved ? (
              <Link href={`/blog/author/${resolved.slug}`}>{resolved.name}</Link>
            ) : (
              slug
            )}
          </span>
        );
      })}
    </>
  );
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
          {posts.map((post) => {
            const primaryTag = getPrimaryTag(post.tags);
            return (
            <li
              key={post.slug}
              style={{
                marginBottom: "2rem",
                paddingBottom: "2rem",
                borderBottom: "1px solid #e5e5e5",
              }}
            >
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
                    marginBottom: "0.5rem",
                  }}
                >
                  {primaryTag.name}
                </span>
              )}
              <h2 style={{ marginBottom: "0.25rem" }}>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
              </h2>
              <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
                {post.date} · <AuthorByline author={post.author} />
              </div>
              {post.excerpt && <p style={{ margin: 0 }}>{post.excerpt}</p>}
            </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
