import Link from "next/link";
import { getCurrentSiteId } from "@/lib/sites/current-site";
import { getSiteConfig } from "@/lib/sites/config";
import { listPosts } from "@/lib/storage/posts";
import { normalizeAuthors, type PostSummary } from "@/lib/storage/schema";

const PAGE_SIZE = 20;

function statusLabel(post: PostSummary): "Draft" | "Published" {
  return post.status === "draft" ? "Draft" : "Published";
}

function statusBadgeClass(post: PostSummary): string {
  return post.status === "draft"
    ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
    : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
}

function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function pageLinkClass(disabled: boolean): string {
  return disabled
    ? "pointer-events-none rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700"
    : "rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const requestedPage = parsePageParam(params.page);

  const siteId = await getCurrentSiteId();
  const site = getSiteConfig(siteId);

  let allPosts: PostSummary[] = [];
  let loadError: string | null = null;
  try {
    allPosts = await listPosts(siteId);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load posts.";
  }

  const totalPosts = allPosts.length;
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));
  // Clamp rather than show an empty out-of-range page — e.g. a stale
  // bookmark to ?page=5 after a site switch to one with fewer posts.
  const currentPage = Math.min(requestedPage, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const posts = allPosts.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Posts
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{site.name}</p>
      </div>

      {loadError ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {loadError}
        </p>
      ) : totalPosts === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          No posts yet for this site.
        </p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Author</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Tags</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr
                    key={post.slug}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50">
                      {post.title}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {normalizeAuthors(post.author).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {post.date}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {post.tags && post.tags.length > 0 ? post.tags.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClass(post)}>
                        {statusLabel(post)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
            <p>
              Showing {startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, totalPosts)} of{" "}
              {totalPosts}
            </p>
            <div className="flex items-center gap-3">
              <Link
                href={`/admin/posts?page=${currentPage - 1}`}
                className={pageLinkClass(currentPage <= 1)}
              >
                Previous
              </Link>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Link
                href={`/admin/posts?page=${currentPage + 1}`}
                className={pageLinkClass(currentPage >= totalPages)}
              >
                Next
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
