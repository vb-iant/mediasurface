import { cookies } from "next/headers";
import { listSites, type SiteId } from "./config";

export const CURRENT_SITE_COOKIE = "ms_current_site";

/**
 * Reads the current-site cookie and validates it against the real list of
 * configured sites. Falls back to the first non-sandbox site if the cookie
 * is unset, or to whatever tampering/staleness produced an invalid value —
 * never trusts the cookie's value blindly, since it's just UI state, not
 * something the storage interface should be handed unchecked.
 */
export async function getCurrentSiteId(): Promise<SiteId> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(CURRENT_SITE_COOKIE)?.value;
  const sites = listSites();

  if (raw && sites.includes(raw as SiteId)) {
    return raw as SiteId;
  }

  // Default to the first real site (not the "mediasurface" sandbox) so a
  // fresh session lands somewhere with real editorial content, not the
  // test/sandbox site.
  return sites.find((id) => id !== "mediasurface") ?? sites[0];
}
