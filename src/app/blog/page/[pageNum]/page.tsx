// Path-based pagination matching Velocity B's /blog/page/N structure.
// This route reads searchParams (for the ?tag= filter), which means
// Next.js renders it dynamically on demand rather than pre-building
// static HTML — same accepted trade-off Velocity B documents in its own
// version of this file, not an oversight here. No generateStaticParams:
// Velocity B's actual route doesn't use one either (a stale comment
// elsewhere in its codebase suggested otherwise — checked the real file,
// this dynamic-only approach is what's actually shipped, so matched that
// rather than the comment).

import { BlogIndexContent } from "@/components/blog/BlogIndexContent";

export default async function BlogIndexPagedPage({
  params,
  searchParams,
}: {
  params: Promise<{ pageNum: string }>;
  searchParams: Promise<{ tag?: string; q?: string }>;
}) {
  const { pageNum } = await params;
  const { tag, q } = await searchParams;
  const currentPage = parseInt(pageNum, 10) || 1;
  return <BlogIndexContent currentPage={currentPage} tagSlug={tag} query={q} />;
}
