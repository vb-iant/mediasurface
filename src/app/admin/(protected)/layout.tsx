import type { ReactNode } from "react";
import Link from "next/link";
import { listSites, getSiteConfig } from "@/lib/sites/config";
import { getCurrentSiteId } from "@/lib/sites/current-site";
import { logout } from "../login/actions";
import { SiteSwitcher } from "./site-switcher";

export default async function AdminShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const currentSite = await getCurrentSiteId();
  const sites = listSites().map((id) => ({
    id,
    name: getSiteConfig(id).name,
  }));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <Link
              href="/admin"
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
            >
              mediasurface
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/admin" className="hover:text-zinc-900 dark:hover:text-zinc-50">
                Dashboard
              </Link>
              <Link
                href="/admin/posts"
                className="hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                Posts
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <SiteSwitcher sites={sites} currentSite={currentSite} />
            <form action={logout}>
              <button
                type="submit"
                className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
