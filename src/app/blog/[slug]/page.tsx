// Blog post detail — reference implementation, see page.tsx and CLAUDE.md
// "Velocity B blog front-end migration" for context.
//
// Statically generated via generateStaticParams, reading content/blog off
// the local filesystem — same reasoning as the index route. No GitHub API
// call, no GITHUB_TOKEN dependency.
//
// A direct URL to a draft's slug 404s, same as a nonexistent slug —
// simpler and safer default than "reachable but unlisted." Admin preview
// of drafts is a different, separate feature inside the gated admin UI.
//
// Author byline uses the shared components/blog/AuthorByline.tsx (also
// used by the index/paginated routes) rather than a local copy.
//
// Tag list and the primary-tag pill above the title both link to
// /blog?tag=slug (functional since pagination shipped, tm-1788532452755) —
// there's no dedicated /blog/tag/[slug] archive page, deliberately (see
// CLAUDE.md); the filtered index is the "tag page." Related posts reuses
// the same PostCard grid as the
// index (tm-1788535981352) rather than a bespoke layout, so it's the
// narrow article column above, opening into the wider grid below — same
// pattern Velocity B uses.
//
// Converted to Tailwind (from inline styles) to match the index page's
// grid conversion — was the last piece of this route still on inline
// styles.

import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {
  getLocalPost,
  getLocalPublishedSlugs,
  getRelatedPosts,
} from "@/lib/blog/local-content";
import { getPrimaryTag, getResolvedTags } from "@/lib/blog/local-tags";
import { AuthorByline } from "@/components/blog/AuthorByline";
import { PostCard } from "@/components/blog/PostCard";

export function generateStaticParams() {
  return getLocalPublishedSlugs().map((slug) => ({ slug }));
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getLocalPost(slug);

  if (!post) notFound();

  const primaryTag = getPrimaryTag(post.tags);
  const allTags = getResolvedTags(post.tags);
  const related = getRelatedPosts(post, 3);

  return (
    <div className="py-12">
      <article className="mx-auto max-w-[720px] px-6">
        <p className="mb-6">
          <Link href="/blog" className="text-sm text-slate-600 hover:text-blue-600">
            &larr; Back to blog
          </Link>
        </p>
        {primaryTag && (
          <Link
            href={`/blog?tag=${primaryTag.slug}`}
            className="mb-3 inline-block rounded-full border border-blue-600 px-4 py-1 text-xs font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-600 hover:text-white"
          >
            {primaryTag.name}
          </Link>
        )}
        <h1 className="mb-2 text-3xl font-bold tracking-tight md:text-4xl">{post.title}</h1>
        <div className="mb-8 text-sm text-slate-500">
          {post.date} · <AuthorByline author={post.author} /> · {post.readingTime}
        </div>
        <div className="leading-relaxed text-slate-700">
          <ReactMarkdown
            components={{
              h2: (props) => <h2 className="mb-3 mt-9 text-2xl font-bold" {...props} />,
              p: (props) => <p className="my-4 text-lg leading-[1.75]" {...props} />,
              a: (props) => <a className="text-blue-600 underline" {...props} />,
              ul: (props) => (
                <ul className="my-4 list-disc pl-6 text-lg leading-[1.75]" {...props} />
              ),
              ol: (props) => (
                <ol className="my-4 list-decimal pl-6 text-lg leading-[1.75]" {...props} />
              ),
            }}
          >
            {post.body}
          </ReactMarkdown>
        </div>
        {allTags.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {allTags.map((tag) => (
              <Link
                key={tag.id}
                href={`/blog?tag=${tag.slug}`}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-800"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        )}
      </article>

      {related.length > 0 && (
        <section className="mx-auto mt-16 max-w-[1180px] border-t border-slate-200 px-6 pt-16 md:px-12">
          <h2 className="mb-8 text-2xl font-bold tracking-tight">Related posts</h2>
          <div className="grid grid-cols-1 gap-x-9 gap-y-11 md:grid-cols-3">
            {related.map((p, i) => (
              <PostCard key={p.slug} post={p} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
