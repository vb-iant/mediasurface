"use client";

import { useRef } from "react";
import { switchSite } from "./actions";

interface SiteOption {
  id: string;
  name: string;
}

export function SiteSwitcher({
  sites,
  currentSite,
}: {
  sites: SiteOption[];
  currentSite: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={switchSite}>
      {/* Redirects back to /admin after switching. Once more protected
          pages exist (post list, editor), this should carry the actual
          current pathname instead of a hardcoded default. */}
      <input type="hidden" name="from" value="/admin" />
      <label htmlFor="site-switcher" className="sr-only">
        Current site
      </label>
      <select
        id="site-switcher"
        name="site"
        defaultValue={currentSite}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-50"
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </form>
  );
}
