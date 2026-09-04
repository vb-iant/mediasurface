// Blog index — reference implementation for how blog listing should work
// across all sites, built and owned in mediasurface. See CLAUDE.md
// "Velocity B blog front-end migration": velocity-b's own code is
// reference-only during this build, not touched — it migrates onto this
// implementation once proven, as a deliberate cutover.
//
// Thin wrapper: all listing/pagination/tag-filter logic lives in
// components/blog/BlogIndexContent.tsx, shared with /blog/page/[pageNum].
// See that file for the searchParams -> dynamic-rendering trade-off.

import { BlogIndexContent } from "@/components/blog/BlogIndexContent";

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const { tag } = await searchParams;
  return <BlogIndexContent currentPage={1} tagSlug={tag} />;
}
