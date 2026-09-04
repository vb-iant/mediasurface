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
//
// Now shows a large avatar (photo or initials fallback, via the shared
// AuthorAvatar component also used in bylines elsewhere) — Velocity B has
// no equivalent since it has no photo capability at all, this is net-new
// (tm-1788540285021). Converted to Tailwind while touching this file,
// matching the rest of the blog reference implementation.

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getAuthorBySlug,
  getPostsByAuthor,
  getLocalAuthorSlugsWithPosts,
} from "@/lib/blog/local-authors";
import { AuthorAvatar } from "@/components/blog/AuthorAvatar";

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
    <main className="mx-auto max-w-[760px] px-6 py-12">
      <p className="mb-6">
        <Link href="/blog" className="text-sm text-slate-600 hover:text-blue-600">
          &larr; Back to blog
        </Link>
      </p>

      <div className="mb-10 flex items-start gap-5">
        <AuthorAvatar author={author} size={88} />
        <div>
          <h1 className="mb-1 text-2xl font-bold tracking-tight">{author.name}</h1>
          {author.role && <p className="mb-2 text-sm text-slate-500">{author.role}</p>}
          {author.linkedin && (
            <a
              href={author.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-blue-600"
            >
              LinkedIn
            </a>
          )}
        </div>
      </div>

      {author.bio && <p className="mb-10 leading-relaxed text-slate-700">{author.bio}</p>}

      <h2 className="mb-4 text-lg font-bold">Posts by {author.name}</h2>
      <ul className="list-none space-y-6 p-0">
        {posts.map((post) => (
          <li key={post.slug} className="border-b border-slate-200 pb-6">
            <h3 className="mb-1">
              <Link href={`/blog/${post.slug}`} className="font-semibold hover:text-blue-600">
                {post.title}
              </Link>
            </h3>
            <div className="text-sm text-slate-500">{post.date}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
