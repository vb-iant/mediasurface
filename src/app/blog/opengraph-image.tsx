// OG image for the blog index. Generic — the index isn't about one tag
// or post, so uses accentIndex=0 (the first accent in the cycle) rather
// than anything tag-derived.

import { renderOgImage, ogSize, ogContentType } from "@/lib/og/render";
import { mediasurfaceOgConfig } from "@/lib/og/mediasurface-config";

export const size = ogSize;
export const contentType = ogContentType;

export default async function Image() {
  return renderOgImage(mediasurfaceOgConfig, {
    eyebrow: "mediasurface",
    title: "Blog",
  });
}
