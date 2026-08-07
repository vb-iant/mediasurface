/**
 * Site-config layer. Routes the admin to the right repo/branch/content path
 * per site. Add a new site here (plus its GitHub PAT in the environment)
 * to onboard it — nothing else in the storage interface needs to change.
 *
 * See CLAUDE.md for the architecture decisions this reflects.
 */

export type SiteId = "velocity-b" | "iantruscott" | "rockstarcmo";

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
  /** Path within the repo where uploaded media should be committed. */
  mediaPath: string;
  /** Live site base URL, used to build preview/"view live" links. */
  siteUrl: string;
}

export const siteConfigs: Record<SiteId, SiteConfig> = {
  "velocity-b": {
    name: "Velocity B",
    repo: "vb-iant/velocity-b",
    branch: "main",
    blogPath: "content/blog",
    authorsPath: "content/authors",
    tagsPath: "content/tags.json",
    mediaPath: "public/images",
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
    mediaPath: "public/images",
    siteUrl: "https://iantruscott.com",
  },
  rockstarcmo: {
    name: "Rockstar CMO",
    // Repo migration in progress — update once it exists.
    repo: "vb-iant/rockstarcmo",
    branch: "main",
    blogPath: "content/blog",
    authorsPath: "content/authors",
    tagsPath: "content/tags.json",
    mediaPath: "public/images",
    // Note: podcast episodes are NOT admin-managed content for this site —
    // they're pulled live via RSS/ISR on the site side. Only blog posts and
    // pages go through this admin. See CLAUDE.md.
    siteUrl: "https://rockstarcmo.com",
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
