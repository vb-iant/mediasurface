/**
 * The storage interface (CLAUDE.md decision #2). The admin UI and each
 * site's schema are built against these four functions, not the GitHub API
 * directly — so a future move to Postgres/Vercel Blob only means rewriting
 * this file's implementation, nothing that calls it.
 *
 * Server-side only.
 */

import matter from "gray-matter";
import readingTime from "reading-time";
import { getSiteConfig, type SiteId } from "@/lib/sites/config";
import {
  getFile,
  listDir,
  putFile,
  GitHubNotFoundError,
} from "@/lib/github/client";
import {
  type Post,
  type PostFrontmatter,
  type PostSummary,
  slugToFilename,
  filenameToSlug,
} from "./schema";

/**
 * Fetches a single post's full content (frontmatter + body) for a site.
 * Throws if the post doesn't exist.
 */
export async function getPost(site: SiteId, slug: string): Promise<Post> {
  const config = getSiteConfig(site);
  const filePath = `${config.blogPath}/${slugToFilename(slug)}`;

  const file = await getFile(config.repo, config.branch, filePath);
  const { data, content: body } = matter(file.content);
  const frontmatter = data as PostFrontmatter;

  return {
    ...frontmatter,
    slug: frontmatter.slug || slug,
    path: filePath,
    body,
    readingTime: readingTime(body).text,
  };
}

/**
 * Lists all posts for a site. Returns lightweight summaries (frontmatter
 * only, no body) so the admin's post-list view doesn't have to fetch and
 * parse every post's full content just to render a table.
 */
export async function listPosts(site: SiteId): Promise<PostSummary[]> {
  const config = getSiteConfig(site);
  const files = await listDir(config.repo, config.branch, config.blogPath);
  const mdFiles = files.filter((f) => f.name.endsWith(".md"));

  const summaries = await Promise.all(
    mdFiles.map(async (f) => {
      const file = await getFile(config.repo, config.branch, f.path);
      const { data } = matter(file.content);
      const frontmatter = data as PostFrontmatter;
      return {
        ...frontmatter,
        slug: frontmatter.slug || filenameToSlug(f.name),
        path: f.path,
      };
    })
  );

  // Newest first.
  return summaries.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Creates or updates a post. `data` is the full frontmatter plus body.
 * Re-fetches the file's current SHA immediately before writing (handled
 * inside putFile) to minimize the window for a stale-SHA 409.
 */
export async function savePost(
  site: SiteId,
  slug: string,
  data: PostFrontmatter & { body: string }
): Promise<void> {
  const config = getSiteConfig(site);
  const filePath = `${config.blogPath}/${slugToFilename(slug)}`;
  const { body, ...frontmatter } = data;

  const fileContent = matter.stringify(body, { ...frontmatter, slug });

  await putFile(
    config.repo,
    config.branch,
    filePath,
    fileContent,
    `${frontmatter.status === "draft" ? "Draft" : "Publish"}: ${frontmatter.title}`
  );
}

/**
 * Deletes a post. Kept alongside savePost since the admin will need it for
 * post management, even though it wasn't in the original four-function
 * list — same GitHub SHA-safety discipline applies underneath.
 */
export async function deletePost(site: SiteId, slug: string): Promise<void> {
  const config = getSiteConfig(site);
  const filePath = `${config.blogPath}/${slugToFilename(slug)}`;
  const { deleteFile } = await import("@/lib/github/client");
  await deleteFile(config.repo, config.branch, filePath, `Delete post: ${slug}`);
}

/**
 * Checks whether a post exists for a given slug, without fetching its full
 * content. Useful for slug-uniqueness checks in the admin's editor.
 */
export async function postExists(site: SiteId, slug: string): Promise<boolean> {
  try {
    await getPost(site, slug);
    return true;
  } catch (err) {
    if (err instanceof GitHubNotFoundError) return false;
    throw err;
  }
}

export type MediaKind = "image" | "document" | "media";

/**
 * Uploads a media file (image, PDF, video, etc.) to the appropriate path
 * for its kind — public/images, public/documents, or public/media — and
 * returns the public path to reference it from a post's featuredImage,
 * inline content, or a resource link. Matches the convention already used
 * for author avatars (e.g. "/images/authors/mark-rattley.png").
 */
export async function saveMedia(
  site: SiteId,
  kind: MediaKind,
  filename: string,
  fileContent: Buffer
): Promise<{ path: string; publicPath: string }> {
  const config = getSiteConfig(site);
  const basePath =
    kind === "image"
      ? config.imagesPath
      : kind === "document"
        ? config.documentsPath
        : config.mediaPath;
  const repoPath = `${basePath}/${filename}`;

  await putFile(
    config.repo,
    config.branch,
    repoPath,
    fileContent,
    `Upload ${kind}: ${filename}`,
    { isBinary: true }
  );

  // public/ is served from site root, so public/images/x.png -> /images/x.png
  const publicPath = repoPath.replace(/^public/, "");

  return { path: repoPath, publicPath };
}
