/**
 * Phase 4: speed & weight — image file sizes, HTML compression, image
 * caching. Uses headers already captured (the link checker's request for
 * each same-site image; the crawler's response for each page). No extra
 * requests: if a server doesn't send a size, that image just isn't judged.
 */

import { isSameSite, urlKey } from "../urls";
import type { AuditResult, LinkCheckResult } from "../types";
import type { Finding, LinkSource } from "./types";

export const IMAGE_WARN_BYTES = 300 * 1024;
export const IMAGE_NOTICE_BYTES = 150 * 1024;
const UNCOMPRESSED_MIN_BYTES = 10 * 1024;
const MIN_CACHE_SECONDS = 24 * 60 * 60;

function isImage(r: LinkCheckResult): boolean {
  if (r.contentType) return r.contentType.toLowerCase().startsWith("image/");
  return /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)(\?|$)/i.test(r.url);
}

function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/** max-age in seconds, 0 for no-store/no-cache, null if no caching headers at all. */
function cacheSeconds(cc: string | null | undefined): number | null {
  if (!cc) return null;
  if (cc.startsWith("expires ")) {
    const t = Date.parse(cc.slice(8));
    return Number.isFinite(t) ? Math.max(0, (t - Date.now()) / 1000) : 0;
  }
  if (/no-store|no-cache/i.test(cc)) return 0;
  const m = cc.match(/(?:s-)?max-age=(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function performanceFindings(audit: AuditResult): Finding[] {
  const { origin } = audit.discovery;
  const findings: Finding[] = [];
  const images = (audit.linkCheck?.results ?? []).filter((r) => r.kind === "asset" && r.verdict === "ok" && isImage(r));

  // Pages using each image, with alt text as the "link text".
  const sources = new Map<string, LinkSource[]>();
  for (const p of audit.pages) {
    if (p.status >= 400 || !p.isHtml) continue;
    for (const a of p.assetLinks ?? []) {
      let list = sources.get(a);
      if (!list) sources.set(a, (list = []));
      if (list.length < 20 && !list.some((s) => s.page === p.finalUrl)) list.push({ page: p.finalUrl, text: p.linkText?.[a] ?? "" });
    }
  }
  const imageFinding = (id: string, title: string, severity: Finding["severity"], hits: LinkCheckResult[], description: string) => {
    if (!hits.length) return;
    hits.sort((a, b) => (b.contentLength ?? 0) - (a.contentLength ?? 0));
    findings.push({
      id,
      title,
      severity,
      category: "performance",
      description,
      urls: hits.map((r) => r.url),
      notes: Object.fromEntries(
        hits.map((r) => {
          const n = sources.get(r.url)?.length ?? 0;
          return [r.url, `${kb(r.contentLength!)} · used on ${n} page${n === 1 ? "" : "s"}`];
        })
      ),
      sources: Object.fromEntries(hits.map((r) => [r.url, sources.get(r.url) ?? []])),
    });
  };
  imageFinding(
    "images-heavy",
    "Very large images",
    "warning",
    images.filter((r) => (r.contentLength ?? 0) > IMAGE_WARN_BYTES),
    `Over ${IMAGE_WARN_BYTES / 1024} KB each. Large images are the most common cause of slow pages, especially on mobile. Resize to the size they're displayed at and use a modern format (WebP/AVIF).`
  );
  imageFinding(
    "images-large",
    "Large images",
    "info",
    images.filter((r) => (r.contentLength ?? 0) > IMAGE_NOTICE_BYTES && (r.contentLength ?? 0) <= IMAGE_WARN_BYTES),
    `Between ${IMAGE_NOTICE_BYTES / 1024} and ${IMAGE_WARN_BYTES / 1024} KB — worth compressing if they appear above the fold.`
  );

  const uncached = images.filter((r) => {
    const s = cacheSeconds(r.cacheControl);
    return s === null || s < MIN_CACHE_SECONDS;
  });
  if (uncached.length) {
    findings.push({
      id: "images-uncached",
      title: "Images browsers must re-check every visit",
      severity: "info",
      category: "performance",
      description:
        "These images have no caching headers, or a cache lifetime under a day, so browsers ask the server about them again on every visit — at best getting a quick \"not modified\" reply, at worst downloading them again. Long-lived caching (e.g. a year for files whose names change when they're edited) saves those round trips. Next.js serves /public files this way by default.",
      urls: uncached.map((r) => r.url),
      notes: Object.fromEntries(uncached.map((r) => [r.url, r.cacheControl ? `Cache: ${r.cacheControl}` : "No cache headers"])),
    });
  }

  const seen = new Set<string>();
  const uncompressed = audit.pages.filter((p) => {
    const k = urlKey(p.finalUrl);
    if (seen.has(k)) return false;
    seen.add(k);
    return (
      p.status === 200 &&
      p.isHtml &&
      isSameSite(p.finalUrl, origin) &&
      p.sizeBytes > UNCOMPRESSED_MIN_BYTES &&
      !p.contentEncoding
    );
  });
  if (uncompressed.length) {
    findings.push({
      id: "html-uncompressed",
      title: "Pages served without compression",
      severity: "warning",
      category: "performance",
      description: "The HTML for these pages is sent uncompressed (no gzip or Brotli), so it's typically 3–5× bigger over the wire than it needs to be. Usually a one-line server or CDN setting.",
      urls: uncompressed.map((p) => p.finalUrl),
      notes: Object.fromEntries(uncompressed.map((p) => [p.finalUrl, kb(p.sizeBytes)])),
    });
  }

  return findings;
}
