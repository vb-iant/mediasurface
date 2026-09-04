// Author archive page — reference implementation, mirrors Velocity B's
// app/blog/author/[slug] (AuthorArchiveContent.tsx). Lists all published
// posts by a given author.
//
// Statically generated via generateStaticParams, reading content/blog and
// content/authors off the local filesystem — same pattern as the rest of
// /blog. No GitHub API call, no GITHUB_TOKEN dependency.
//
// 404s if the slug has no author profile OR has a profile but zero
// published posts, rather than rendering an empty/broken page — same
// "simpler, safer default" policy as a direct draft URL 404ing on the
// post detail route.

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getAuthorBySlug,
  getPostsByAuthor,
  getLocalAuthorSlugsWithPosts,
} from "@/lib/blog/local-authors";

export function generateStaticParams() {
  return getLocalAuthorSlugsWithPosts().map((slug) => ({ slug }));
}

export default async function AuthorArchivePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const author = getAuthorBySlug(slug);
  const posts = author ? getPostsByAuthor(slug) : [];

  if (!author || posts.length === 0) notFound();

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 760, margin: "0 auto" }}>
      <p style={{ marginBottom: "1.5rem" }}>
        <Link href="/blog">&larr; Back to blog</Link>
      </p>

      <h1 style={{ marginBottom: "0.25rem" }}>{author.name}</h1>
      {author.role && (
        <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
          {author.role}
        </p>
      )}
      {author.linkedin && (
        <p style={{ marginBottom: "1.5rem" }}>
          <a href={author.linkedin} target="_blank" rel="noopener noreferrer">
            LinkedIn
          </a>
        </p>
      )}
      {author.bio && <p style={{ marginBottom: "2.5rem" }}>{author.bio}</p>}

      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
        Posts by {author.name}
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {posts.map((post) => (
          <li
            key={post.slug}
            style={{
              marginBottom: "1.5rem",
              paddingBottom: "1.5rem",
              borderBottom: "1px solid #e5e5e5",
            }}
          >
            <h3 style={{ marginBottom: "0.25rem" }}>
              <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            </h3>
            <div style={{ fontSize: "0.875rem", color: "#666" }}>{post.date}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
