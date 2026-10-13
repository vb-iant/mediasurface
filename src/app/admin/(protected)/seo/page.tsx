import type { Metadata } from "next";
import { SeoHome } from "./seo-home";

export const metadata: Metadata = {
  title: "SEO audit · mediasurface",
};

export default function SeoPage() {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">SEO audit</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Any website · up to 5,000 pages</p>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
        The technical audit finds every page on a site from its sitemap and internal links, then checks links,
        on-page SEO, site structure, structured data, page weight and AI crawler access. The content scan maps what the
        site is about and checks the client&apos;s target phrases. Results stay in this browser tab until you close
        it — they aren&apos;t saved anywhere else.
      </p>
      <SeoHome />
    </div>
  );
}
