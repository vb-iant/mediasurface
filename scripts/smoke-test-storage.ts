/**
 * Read-only smoke test for the storage interface. Exercises listPosts and
 * getPost against a real site's content. Does NOT call savePost/saveMedia —
 * those are write operations and shouldn't run against a live site's repo
 * outside of the actual admin UI.
 *
 * Usage:
 *   export GITHUB_TOKEN=ghp_xxx
 *   npx tsx scripts/smoke-test-storage.ts [site]   # defaults to velocity-b
 */
import { listPosts, getPost } from "../src/lib/storage/posts";
import type { SiteId } from "../src/lib/sites/config";

const site = (process.argv[2] as SiteId) || "velocity-b";

async function main() {
  const summaries = await listPosts(site);
  console.log(`listPosts("${site}") returned ${summaries.length} posts.`);
  console.log("First 3:", summaries.slice(0, 3).map((p) => ({
    slug: p.slug,
    title: p.title,
    date: p.date,
    author: p.author,
    tags: p.tags,
  })));

  const first = summaries[0];
  const full = await getPost(site, first.slug);
  console.log(`\ngetPost("${site}", "${first.slug}") ->`);
  console.log({
    title: full.title,
    author: full.author,
    tags: full.tags,
    readingTime: full.readingTime,
    bodyLength: full.body.length,
    bodyPreview: full.body.slice(0, 100),
  });
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
