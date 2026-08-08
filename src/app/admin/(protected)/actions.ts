"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listAvailableSites, type SiteId } from "@/lib/sites/config";
import { CURRENT_SITE_COOKIE } from "@/lib/sites/current-site";

export async function switchSite(formData: FormData): Promise<void> {
  const requested = String(formData.get("site") ?? "");
  const from = String(formData.get("from") ?? "/admin");
  const sites = listAvailableSites();

  // Never trust the submitted value blindly, even though it came from our
  // own <select> — someone could still POST an arbitrary value directly.
  if (!sites.includes(requested as SiteId)) {
    redirect(from.startsWith("/admin") ? from : "/admin");
  }

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_SITE_COOKIE, requested, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // a year — this is a UI preference, not a session
  });

  redirect(from.startsWith("/admin") ? from : "/admin");
}
