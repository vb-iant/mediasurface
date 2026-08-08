import { getCurrentSiteId } from "@/lib/sites/current-site";
import { getSiteConfig } from "@/lib/sites/config";

export default async function AdminHome() {
  const siteId = await getCurrentSiteId();
  const site = getSiteConfig(siteId);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {site.name}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {site.repo}@{site.branch}
      </p>
      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        Post list and editor land here next.
      </p>
    </div>
  );
}
