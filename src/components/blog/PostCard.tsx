// Post card for the grid index — mirrors Velocity B's
// components/blog/PostCard.tsx structure (accent border cycling by
// index, tag pill, title, excerpt, byline) but uses Tailwind's default
// palette rather than Velocity B's custom brand tokens (navy/blue/orange/
// hair aren't defined in mediasurface's theme — this reference
// implementation is intentionally unbranded; Martech Insiders and any
// future site bring their own design system on top of this structure).

import Link from "next/link";
import type { PostSummary } from "@/lib/storage/schema";
import { getPrimaryTag } from "@/lib/blog/local-tags";
import { AuthorByline } from "@/components/blog/AuthorByline";

const ACCENT_BORDERS = ["border-t-blue-600", "border-t-orange-500", "border-t-slate-800"];

export function PostCard({ post, index }: { post: PostSummary; index: number }) {
  const primaryTag = getPrimaryTag(post.tags);

  return (
    <div className={`border-t-4 pt-5 ${ACCENT_BORDERS[index % ACCENT_BORDERS.length]}`}>
      {primaryTag && (
        <span className="mb-3 inline-block rounded-full border border-blue-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-600">
          {primaryTag.name}
        </span>
      )}
      <h2 className="mb-2 text-lg font-bold leading-snug">
        <Link href={`/blog/${post.slug}`} className="hover:text-blue-600">
          {post.title}
        </Link>
      </h2>
      {post.excerpt && (
        <p className="mb-3 text-sm leading-relaxed text-slate-600">{post.excerpt}</p>
      )}
      <div className="text-xs text-slate-500">
        <AuthorByline author={post.author} /> · {post.date}
      </div>
    </div>
  );
}
