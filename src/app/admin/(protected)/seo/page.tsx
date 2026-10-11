import type { Metadata } from "next";
import { SeoAudit } from "./seo-audit";

export const metadata: Metadata = {
  title: "SEO audit · mediasurface",
};

export default function SeoPage() {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">SEO audit</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Any website · up to 500 pages</p>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
        Finds every page on a site from its sitemap and internal links, then reports broken
        pages, redirects and sitemap gaps. Results stay in this browser tab — they aren&apos;t saved.
      </p>
      <SeoAudit />
    </div>
  );
}
