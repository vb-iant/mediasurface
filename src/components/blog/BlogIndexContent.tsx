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
import { searchPosts } from "@/lib/blog/search";
import { PostCard } from "@/components/blog/PostCard";
import type { PostSummary, Tag } from "@/lib/storage/schema";

export const BLOG_PAGE_SIZE = 9;

export function getUnfilteredBlogPageCount(): number {
  return Math.max(1, Math.ceil(getLocalPosts().length / BLOG_PAGE_SIZE));
}

export function BlogIndexContent({
  currentPage,
  tagSlug,
  query,
}: {
  currentPage: number;
  tagSlug?: string;
  query?: string;
}) {
  const allPosts = getLocalPosts();
  const tags = getAllTags();

  const unfilteredTotalPages = getUnfilteredBlogPageCount();
  if (currentPage > unfilteredTotalPages || currentPage < 1) {
    notFound();
  }

  const activeTag: Tag | null = tagSlug ? getTagBySlug(tagSlug) : null;
  const tagFilteredPosts: PostSummary[] = activeTag
    ? allPosts.filter((p) => p.tags?.includes(activeTag.slug))
    : allPosts;

  // Search runs on top of the tag filter, so "search within Sales posts"
  // works without extra wiring — searchPosts() is a no-op passthrough when
  // query is empty, so this is safe to call unconditionally.
  const filteredPosts: PostSummary[] = searchPosts(tagFilteredPosts, query);

  // A search/tag combo can validly produce zero results on a page number
  // that was fine before either filter was applied — that's an empty
  // result set to show, not a 404. Only the raw page-number bound (above)
  // is a 404; an empty filtered page renders the "no posts" message below.
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / BLOG_PAGE_SIZE));
  const pageForSlice = Math.min(currentPage, totalPages);
  const pagePosts = filteredPosts.slice(
    (pageForSlice - 1) * BLOG_PAGE_SIZE,
    pageForSlice * BLOG_PAGE_SIZE
  );

  function pageHref(page: number): string {
    const base = page <= 1 ? "/blog" : `/blog/page/${page}`;
    const params = new URLSearchParams();
    if (activeTag) params.set("tag", activeTag.slug);
    if (query?.trim()) params.set("q", query.trim());
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  function tagHref(slug?: string): string {
    const params = new URLSearchParams();
    if (slug) params.set("tag", slug);
    if (query?.trim()) params.set("q", query.trim());
    const qs = params.toString();
    return qs ? `/blog?${qs}` : "/blog";
  }

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-12 md:px-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Blog</h1>

      {/* Plain GET form — no client component needed. Submitting navigates
          to /blog?q=...(&tag=...), the same server-rendered round trip tag
          pills already use. Preserves the active tag via a hidden field so
          "search within Sales posts" survives a fresh search submission. */}
      <form action="/blog" method="get" className="mb-8">
        {activeTag && <input type="hidden" name="tag" value={activeTag.slug} />}
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search posts…"
          aria-label="Search posts"
          className="w-full max-w-md rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-[15px] text-slate-800 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none"
        />
      </form>

      {tags.length > 0 && (
        <div className="mb-12 flex flex-wrap gap-2.5">
          <Link
            href={tagHref(undefined)}
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
              href={tagHref(tag.slug)}
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
        <p className="text-slate-600">
          {query?.trim() ? "No posts found for this search." : "No posts found for this tag yet."}
        </p>
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
