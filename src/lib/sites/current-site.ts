import { cookies } from "next/headers";
import { listAvailableSites, type SiteId } from "./config";

export const CURRENT_SITE_COOKIE = "ms_current_site";

/**
 * Reads the current-site cookie and validates it against the sites
 * currently available for selection (not just configured — a site can be
 * configured but hidden via `available: false`). Falls back to the first
 * non-sandbox available site if the cookie is unset, points at a hidden
 * site, or otherwise doesn't match — never trusts the cookie's value
 * blindly, since it's just UI state, not something the storage interface
 * should be handed unchecked.
 */
export async function getCurrentSiteId(): Promise<SiteId> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(CURRENT_SITE_COOKIE)?.value;
  const sites = listAvailableSites();

  if (raw && sites.includes(raw as SiteId)) {
    return raw as SiteId;
  }

  // Default to the first real site (not the "mediasurface" sandbox) so a
  // fresh session lands somewhere with real editorial content, not the
  // test/sandbox site.
  return sites.find((id) => id !== "mediasurface") ?? sites[0];
}
