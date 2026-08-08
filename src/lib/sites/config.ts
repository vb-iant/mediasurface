/**
 * Site-config layer. Routes the admin to the right repo/branch/content path
 * per site. Add a new site here (plus its GitHub PAT in the environment)
 * to onboard it — nothing else in the storage interface needs to change.
 *
 * See CLAUDE.md for the architecture decisions this reflects.
 */

export type SiteId = "velocity-b" | "iantruscott" | "rockstarcmo" | "mediasurface";

export interface SiteConfig {
  /** Human-readable name, for admin UI display. */
  name: string;
  /** owner/repo on GitHub. */
  repo: string;
  /** Branch content is read from / committed to. */
  branch: string;
  /** Path within the repo where blog posts live. */
  blogPath: string;
  /** Path within the repo where authors live (if applicable). */
  authorsPath?: string;
  /** Path to a tags.json file, if the site uses one. */
  tagsPath?: string;
  /** Path within the repo where uploaded images are committed (also holds
   *  pre-existing site assets like author avatars — no migration needed). */
  imagesPath: string;
  /** Path within the repo where uploaded PDFs/documents are committed. */
  documentsPath: string;
  /** Path within the repo where other uploaded media (video, audio, etc.)
   *  is committed. */
  mediaPath: string;
  /** Live site base URL, used to build preview/"view live" links. */
  siteUrl: string;
  /** Whether this site is selectable in the admin (switcher, current-site
   *  validation). Defaults to true if omitted. Set to false for a site
   *  that's configured but not yet ready for real editorial use — the
   *  config (repo, paths, schema) stays intact for when it is, it's just
   *  not offered as an option in the meantime. See CLAUDE.md. */
  available?: boolean;
}

export const siteConfigs: Record<SiteId, SiteConfig> = {
  mediasurface: {
    name: "mediasurface (test/sandbox)",
    // Self-referential by design: this is mediasurface's OWN repo, the
    // same one the admin app itself runs from. Not a real editorial site —
    // it's where new front-end functionality (new schema fields, new
    // display logic) gets built and tested end-to-end, editor UI included,
    // before the proven code is ported to velocity-b/rockstarcmo/
    // iantruscott. A content commit here redeploys the admin app itself
    // (same Vercel project) — expected and fine for a test site, unlike
    // the other three where admin and site are separate deployments.
    repo: "vb-iant/mediasurface",
    branch: "main",
    blogPath: "content/blog",
    imagesPath: "public/images",
    documentsPath: "public/documents",
    mediaPath: "public/media",
    siteUrl: "https://mediasurface.app/blog",
  },
  "velocity-b": {
    name: "Velocity B",
    repo: "vb-iant/velocity-b",
    branch: "main",
    blogPath: "content/blog",
    authorsPath: "content/authors",
    tagsPath: "content/tags.json",
    imagesPath: "public/images",
    documentsPath: "public/documents",
    mediaPath: "public/media",
    siteUrl: "https://velocity-b.com",
  },
  iantruscott: {
    name: "iantruscott.com",
    // Repo not yet created — update once it exists.
    repo: "vb-iant/iantruscott",
    branch: "main",
    blogPath: "content/blog",
    authorsPath: "content/authors",
    tagsPath: "content/tags.json",
    imagesPath: "public/images",
    documentsPath: "public/documents",
    mediaPath: "public/media",
    siteUrl: "https://iantruscott.com",
    // Hidden from the switcher 2026-08-08 (per Ian) — no repo exists yet,
    // nothing here to actually select. Re-enable once the repo is created
    // and this site is genuinely ready for editorial use.
    available: false,
  },
  rockstarcmo: {
    name: "Rockstar CMO",
    // Confirmed 2026-08-08 against the real repo (was wrongly "rockstarcmo"
    // — no hyphen — before this fix; that mismatch would have silently
    // shown this site's 373 real migrated posts as "no posts yet", since
    // listDir treats a 404 as an empty/newly-onboarded site rather than an
    // error).
    repo: "vb-iant/rockstar-cmo",
    branch: "main",
    blogPath: "content/blog",
    authorsPath: "content/authors",
    tagsPath: "content/tags.json",
    imagesPath: "public/images",
    documentsPath: "public/documents",
    mediaPath: "public/media",
    // Note: podcast episodes are NOT admin-managed content for this site —
    // they're pulled live via RSS/ISR on the site side. Only blog posts and
    // pages go through this admin. See CLAUDE.md.
    siteUrl: "https://rockstarcmo.com",
    // Hidden from the switcher 2026-08-08 (per Ian) — real posts (WordPress
    // migration) diverge from the normalized schema (tags vs. series,
    // author name vs. slug, image vs. featuredImage — see CLAUDE.md "Post
    // list view + two real bugs found and fixed"). Re-enable once that
    // schema reconciliation happens, designed against the mediasurface
    // reference implementation first.
    available: false,
  },
};

export function getSiteConfig(site: SiteId): SiteConfig {
  const config = siteConfigs[site];
  if (!config) {
    throw new Error(`Unknown site: ${site}`);
  }
  return config;
}

export function listSites(): SiteId[] {
  return Object.keys(siteConfigs) as SiteId[];
}

/** Sites selectable in the admin (switcher, current-site validation) —
 *  excludes any site explicitly marked `available: false`. Prefer this
 *  over listSites() everywhere the UI or a security-relevant check needs
 *  "what can actually be picked right now," not "everything configured." */
export function listAvailableSites(): SiteId[] {
  return listSites().filter((id) => siteConfigs[id].available !== false);
}
