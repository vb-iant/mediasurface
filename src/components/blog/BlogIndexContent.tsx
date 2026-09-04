// Shared blog index content — pagination + tag filtering + a 3-column
// grid layout, mirroring Velocity B's components/blog/BlogIndexContent.tsx
// structurally (grid, filter pills, pager) though with Tailwind's default
// palette rather than Velocity B's custom brand theme — see PostCard.tsx.
// Used by both /blog (currentPage=1) and /blog/page/[pageNum].
//
// IMPORTANT: this component reads a `tagSlug` prop that ultimately comes
// from searchParams in the page.tsx wrappers. Reading searchParams makes
// Next.js render the route dynamically (on demand) rather than
// pre-building static HTML at build time — confirmed as an accepted
// trade-off in Velocity B's own /blog/page/[pageNum]/page.tsx comment, not
// an oversight here. Still zero GitHub-API/GITHUB_TOKEN dependency: this
// reads content/blog and content/tags.json off the local filesystem
// either way, static or dynamic.
//
// Page-number validity is checked against the UNFILTERED total (matching
// Velocity B): a wildly out-of-range page in the URL is a real 404
// regardless of what a tag filter narrows the results down to, since the
// path segment's meaning comes from the full post list.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocalPosts } from "@/lib/blog/local-content";
import { getAllTags, getTagBySlug } from "@/lib/blog/local-tags";
import { PostCard } from "@/components/blog/PostCard";
import type { PostSummary, Tag } from "@/lib/storage/schema";

export const BLOG_PAGE_SIZE = 9;

export function getUnfilteredBlogPageCount(): number {
  return Math.max(1, Math.ceil(getLocalPosts().length / BLOG_PAGE_SIZE));
}

export function BlogIndexContent({
  currentPage,
  tagSlug,
}: {
  currentPage: number;
  tagSlug?: string;
}) {
  const allPosts = getLocalPosts();
  const tags = getAllTags();

  const unfilteredTotalPages = getUnfilteredBlogPageCount();
  if (currentPage > unfilteredTotalPages || currentPage < 1) {
    notFound();
  }

  const activeTag: Tag | null = tagSlug ? getTagBySlug(tagSlug) : null;
  const filteredPosts: PostSummary[] = activeTag
    ? allPosts.filter((p) => p.tags?.includes(activeTag.slug))
    : allPosts;

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / BLOG_PAGE_SIZE));
  const pageForSlice = Math.min(currentPage, totalPages);
  const pagePosts = filteredPosts.slice(
    (pageForSlice - 1) * BLOG_PAGE_SIZE,
    pageForSlice * BLOG_PAGE_SIZE
  );

  function pageHref(page: number): string {
    const base = page <= 1 ? "/blog" : `/blog/page/${page}`;
    return activeTag ? `${base}?tag=${activeTag.slug}` : base;
  }

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-12 md:px-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Blog</h1>

      {tags.length > 0 && (
        <div className="mb-12 flex flex-wrap gap-2.5">
          <Link
            href="/blog"
            className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
              !activeTag
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-800"
            }`}
          >
            All
          </Link>
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/blog?tag=${tag.slug}`}
              className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
                activeTag?.slug === tag.slug
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-800"
              }`}
            >
              {tag.name}
            </Link>
          ))}
        </div>
      )}

      {pagePosts.length === 0 ? (
        <p className="text-slate-600">No posts found for this tag yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-9 gap-y-11 md:grid-cols-3">
          {pagePosts.map((post, i) => (
            <PostCard key={post.slug} post={post} index={i} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-16 flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={pageHref(p)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                p === pageForSlice
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:text-blue-600"
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
