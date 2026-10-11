/**
 * Phase 3: broken-link findings. Pure — reads the crawled pages (internal
 * links and their status) and audit.linkCheck (status-only checks on
 * external links and same-site files/images).
 *
 * Naming per Ian (2026-10-11): the headline finding is "Broken links", not
 * "Pages that failed to load" — what someone fixes is the link, so each
 * broken URL lists the pages linking to it and the link text.
 */

import { isSameSite, urlKey } from "../urls";
import type { AuditPage, AuditResult, LinkCheckResult } from "../types";
import type { Finding, LinkSource } from "./types";

/** How many linking pages to list per broken URL (the note gives the full count). */
const MAX_SOURCES = 20;

function isBroken(p: AuditPage): boolean {
  return p.status === 0 || p.status >= 400;
}

function fileLabel(url: string): string {
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    if (["jpg", "jpeg", "png", "gif", "svg", "webp", "avif", "ico", "bmp"].includes(ext)) return "Image";
    if (ext === "pdf") return "PDF";
    return ext && ext.length <= 5 ? `${ext.toUpperCase()} file` : "File";
  } catch {
    return "File";
  }
}

function relative(url: string, origin: string): string {
  try {
    const u = new URL(url);
    return u.origin === new URL(origin).origin ? `${u.pathname}${u.search}` || "/" : url;
  } catch {
    return url;
  }
}

/** Who links to what: exact URL (externals, files) and urlKey (internal pages). */
function indexSources(pages: AuditPage[], origin: string) {
  const byKey = new Map<string, LinkSource[]>();
  const byUrl = new Map<string, LinkSource[]>();
  const add = (map: Map<string, LinkSource[]>, key: string, src: LinkSource) => {
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    if (!list.some((s) => s.page === src.page)) list.push(src);
  };
  for (const p of pages) {
    if (isBroken(p) || !p.isHtml || !isSameSite(p.finalUrl, origin)) continue;
    const from = p.finalUrl;
    for (const l of p.internalLinks) add(byKey, urlKey(l), { page: from, text: p.linkText?.[l] ?? "" });
    for (const l of p.assetLinks ?? []) add(byUrl, l, { page: from, text: p.linkText?.[l] ?? "" });
    for (const l of p.externalLinks ?? []) add(byUrl, l, { page: from, text: p.linkText?.[l] ?? "" });
  }
  return { byKey, byUrl };
}

function linkedFrom(count: number): string {
  return count === 0 ? "not linked from any crawled page" : `linked from ${count} page${count === 1 ? "" : "s"}`;
}

export function linkFindings(audit: AuditResult): Finding[] {
  const { origin } = audit.discovery;
  const findings: Finding[] = [];
  const { byKey, byUrl } = indexSources(audit.pages, origin);
  const checks = audit.linkCheck?.results ?? [];
  const checksDone = audit.linkCheck?.status === "complete";

  // ---------------------------------------------- broken links (own site)
  const urls: string[] = [];
  const notes: Record<string, string> = {};
  const sources: Record<string, LinkSource[]> = {};
  const seen = new Set<string>();

  for (const p of audit.pages) {
    if (!isBroken(p)) continue;
    const key = urlKey(p.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const srcs = byKey.get(key) ?? [];
    const result = p.status ? `HTTP ${p.status}` : p.error ?? "No response";
    const via = p.redirectChain.length ? `redirects to ${relative(p.finalUrl, origin)}, which returns ` : "";
    const where = srcs.length ? linkedFrom(srcs.length) : p.inSitemap ? "only listed in the sitemap" : linkedFrom(0);
    urls.push(p.url);
    notes[p.url] = `${via ? via[0].toUpperCase() + via.slice(1) : ""}${result} · ${where}`;
    if (srcs.length) sources[p.url] = srcs.slice(0, MAX_SOURCES);
  }
  for (const c of checks) {
    if (c.kind !== "asset" || c.verdict !== "broken") continue;
    const srcs = byUrl.get(c.url) ?? [];
    urls.push(c.url);
    notes[c.url] = `${fileLabel(c.url)} · ${c.reason} · ${linkedFrom(srcs.length)}`;
    if (srcs.length) sources[c.url] = srcs.slice(0, MAX_SOURCES);
  }
  if (urls.length) {
    findings.push({
      id: "broken-links",
      title: "Broken links",
      severity: "error",
      category: "links",
      description:
        "Links to pages, files or images on this site that don't load (404s, server errors, or redirects that end in one). Each shows the pages linking to it — fix or remove those links.",
      urls,
      notes,
      sources,
      caveat:
        !checksDone && audit.linkCheck?.status !== "skipped"
          ? "File and image checks didn't finish, so broken files may be missing from this list."
          : undefined,
    });
  }

  // ---------------------------------------------------- external links
  const external = (verdict: LinkCheckResult["verdict"], kinds: LinkCheckResult["kind"][]) => {
    const hits = checks.filter((c) => c.verdict === verdict && kinds.includes(c.kind));
    return {
      urls: hits.map((c) => c.url),
      notes: Object.fromEntries(
        hits.map((c) => {
          const n = byUrl.get(c.url)?.length ?? 0;
          const label = c.kind === "asset" ? `${fileLabel(c.url)} · ` : "";
          return [c.url, `${label}${c.reason} · ${linkedFrom(n)}`];
        })
      ),
      sources: Object.fromEntries(hits.map((c) => [c.url, (byUrl.get(c.url) ?? []).slice(0, MAX_SOURCES)])),
    };
  };

  const brokenExt = external("broken", ["external"]);
  if (brokenExt.urls.length) {
    findings.push({
      id: "broken-external",
      title: "Broken external links",
      severity: "warning",
      category: "links",
      description:
        "Links to other websites that are gone: 404s, domains that no longer exist, refused connections, certificate errors or repeated server errors. Update or remove them.",
      ...brokenExt,
    });
  }

  const unverified = external("unverified", ["external", "asset"]);
  if (unverified.urls.length) {
    findings.push({
      id: "links-unverified",
      title: "Links we couldn't verify",
      severity: "info",
      category: "links",
      description:
        "These sites blocked our checker, asked for a login, rate-limited us or timed out. That's usually bot protection, not a dead link (LinkedIn, for example, blocks all automated checks) — open them yourself if in doubt.",
      ...unverified,
    });
  }

  const lc = audit.linkCheck;
  if (lc?.externalSkipped) {
    findings.push({
      id: "links-external-skipped",
      title: "External links weren't checked",
      severity: "info",
      category: "links",
      description: `"Check external links" was turned off for this audit, so ${lc.externalNotChecked.toLocaleString("en-GB")} unique links to other sites weren't checked. This site's own pages, files and images were.`,
      urls: [],
    });
  }
  if (lc && lc.found > lc.total) {
    findings.push({
      id: "links-not-checked",
      title: "Some links weren't checked",
      severity: "info",
      category: "links",
      description: `Found ${lc.found.toLocaleString("en-GB")} unique external links, files and images; checked the first ${lc.total.toLocaleString("en-GB")} found.`,
      urls: [],
    });
  }
  if (lc && lc.status === "cancelled") {
    findings.push({
      id: "links-check-stopped",
      title: "Link checks stopped early",
      severity: "info",
      category: "links",
      description: `Checked ${lc.results.length.toLocaleString("en-GB")} of ${lc.total.toLocaleString("en-GB")} links before stopping. Lists above cover only those.`,
      urls: [],
    });
  }

  return findings;
}
