// OG image for a single post. Respects ogImageSource/featuredImage
// (schema fields already added when the editor's toggle was scoped,
// tm-1786118546972) — "featured" serves the featured image directly,
// anything else (including unset, which defaults to "generated" per the
// schema doc) generates a card via renderOgImage. Matches the choice
// Velocity B's own lib/og.tsx will eventually need to make once it
// migrates onto this reference implementation.
//
// Per the schema's own doc comment: featuredImage being empty makes
// ogImageSource irrelevant regardless of its value — the featured-image
// branch below only runs if BOTH are set, falling through to the
// generated card otherwise.

import fs from "fs";
import path from "path";
import { getLocalPost } from "@/lib/blog/local-content";
import { getPrimaryTag, accentIndexForTag } from "@/lib/blog/local-tags";
import { renderOgImage, ogSize, ogContentType } from "@/lib/og/render";
import { mediasurfaceOgConfig } from "@/lib/og/mediasurface-config";

export const size = ogSize;
export const contentType = ogContentType;

const EXT_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getLocalPost(slug);

  if (!post) {
    return renderOgImage(mediasurfaceOgConfig, { eyebrow: "mediasurface", title: "Blog" });
  }

  if (post.ogImageSource === "featured" && post.featuredImage) {
    const filePath = path.join(process.cwd(), "public", post.featuredImage);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const buffer = fs.readFileSync(filePath);
      return new Response(new Uint8Array(buffer), {
        headers: { "Content-Type": EXT_CONTENT_TYPES[ext] ?? "application/octet-stream" },
      });
    }
    // featuredImage path set but file missing — fall through to
    // generated rather than erroring; a broken OG image is worse than a
    // slightly-wrong one.
  }

  const primaryTag = getPrimaryTag(post.tags);
  return renderOgImage(mediasurfaceOgConfig, {
    eyebrow: primaryTag?.name ?? "mediasurface",
    title: post.title,
    accentIndex: accentIndexForTag(primaryTag?.slug),
  });
}
