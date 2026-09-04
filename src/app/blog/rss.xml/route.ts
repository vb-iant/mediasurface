// RSS 2.0 feed for the reference blog. Mirrors Velocity B's own
// app/blog/rss.xml/route.ts structurally (same XML shape, same escaping,
// same fields), with two differences:
//
// 1. Base URL comes from src/lib/sites/config.ts's siteConfigs.mediasurface
//    .siteUrl ("https://mediasurface.app/blog") rather than a separate
//    NEXT_PUBLIC_SITE_URL env var — mediasurface already has this exact
//    field ("Live site base URL") for this purpose, no need for a second
//    source of truth for the same thing.
// 2. Author resolution uses normalizeAuthors() so a multi-author post
//    (schema-supported even though the UI decision is still backlogged,
//    tm-1786120853654) emits one <dc:creator> per author rather than
//    assuming a single string.
//
// Reads content/blog off the local filesystem via getLocalPosts() — same
// no-GitHub-API pattern as the rest of /blog.

import { getLocalPosts } from "@/lib/blog/local-content";
import { getAuthorBySlug } from "@/lib/blog/local-authors";
import { normalizeAuthors } from "@/lib/storage/schema";
import { getSiteConfig } from "@/lib/sites/config";

const BLOG_URL = getSiteConfig("mediasurface").siteUrl;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const posts = getLocalPosts();

  const items = posts
    .map((post) => {
      const url = `${BLOG_URL}/${post.slug}`;
      const authorNames = normalizeAuthors(post.author)
        .map((slug) => getAuthorBySlug(slug)?.name)
        .filter((name): name is string => Boolean(name));
      const pubDate = new Date(post.date).toUTCString();
      const creators = authorNames
        .map((name) => `\n      <dc:creator>${escapeXml(name)}</dc:creator>`)
        .join("");
      return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>${creators}${
        post.excerpt ? `\n      <description>${escapeXml(post.excerpt)}</description>` : ""
      }
    </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>mediasurface Blog (reference implementation)</title>
    <link>${BLOG_URL}</link>
    <atom:link href="${BLOG_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Reference blog feed — mediasurface admin project.</description>
    <language>en-gb</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
