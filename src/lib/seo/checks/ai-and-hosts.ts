/**
 * Phase 4: AI crawler access and host/HTTPS consistency. Both read data
 * gathered during discovery (robots.txt groups, /llms.txt, four homepage
 * variants).
 */

import { AI_BOTS } from "../ai-bots";
import type { AuditResult } from "../types";
import type { Finding } from "./types";

/**
 * AI crawlers (Ian's decision, 2026-10-11): the report shows a panel with
 * every bot; the only finding is ONE warning when search/answer bots are
 * blocked. Blocking training bots is a legitimate choice, so it's not a
 * finding at all.
 */
export function aiFindings(audit: AuditResult): Finding[] {
  const ai = audit.discovery.ai;
  if (!ai) return [];
  const blocked = ai.bots.filter((b) => {
    const bot = AI_BOTS.find((x) => x.token === b.token);
    return bot && bot.group !== "training" && (!b.allowedRoot || !b.allowedStart);
  });
  if (!blocked.length) return [];
  const robotsUrl = audit.discovery.robots.url;
  return [
    {
      id: "ai-search-blocked",
      title: "AI search and answer bots are blocked",
      severity: "warning",
      category: "ai",
      description: `robots.txt blocks ${blocked.map((b) => b.token).join(", ")}. These fetch pages so AI assistants can cite and link to them in answers — increasingly a source of traffic — so blocking them is usually unintended (often an old blanket rule). Blocking AI training bots is a separate, neutral choice. See the AI crawler access panel for the full picture.`,
      urls: [robotsUrl],
      notes: {
        [robotsUrl]: blocked
          .map((b) => {
            const bot = AI_BOTS.find((x) => x.token === b.token)!;
            return `${b.token}${b.explicit ? " (named)" : " (via *)"}${bot.mayIgnoreRobots ? " — may ignore robots.txt anyway" : ""}`;
          })
          .join(" · "),
      },
    },
  ];
}

function show(url: string): string {
  return url.replace(/\/$/, "");
}

export function hostFindings(audit: AuditResult): Finding[] {
  const hosts = audit.discovery.hosts;
  if (!hosts?.length) return [];
  const canonical = new URL(audit.discovery.origin);
  const findings: Finding[] = [];
  const failed: Record<string, string> = {};
  const missingDns: Record<string, string> = {};
  const duplicate: Record<string, string> = {};
  const slow: Record<string, string> = {};

  for (const h of hosts) {
    const isCanonical = new URL(h.url).origin === canonical.origin;
    if (h.error && /domain not found/i.test(h.error)) {
      if (!isCanonical) missingDns[h.url] = "Domain doesn't exist (no DNS record)";
      continue;
    }
    if (h.error || h.status >= 400) {
      failed[h.url] = h.error ?? `HTTP ${h.status}`;
      continue;
    }
    if (isCanonical) continue;
    if (!h.reachesCanonical) {
      const final = new URL(h.finalUrl);
      const sameSite = final.hostname.replace(/^www\./, "") === canonical.hostname.replace(/^www\./, "");
      if (sameSite) duplicate[h.url] = `Serves the site at ${show(final.origin)} instead of redirecting to ${show(canonical.origin)}`;
      else failed[h.url] = `Ends up at ${h.finalUrl}`;
    } else if (h.hops > 1) {
      slow[h.url] = `${h.hops} redirects to reach ${show(canonical.origin)}`;
    }
  }

  const add = (id: string, title: string, severity: Finding["severity"], notes: Record<string, string>, description: string) => {
    if (Object.keys(notes).length) findings.push({ id, title, severity, category: "status", description, urls: Object.keys(notes), notes });
  };
  add(
    "hosts-failed",
    "Site address variants that don't work",
    "error",
    failed,
    `People and links reach a site via http/https and with or without www. These variants fail or go somewhere else; each should redirect to ${show(canonical.origin)}.`
  );
  add(
    "hosts-duplicate",
    "Site served on more than one address",
    "warning",
    duplicate,
    `These variants serve the site instead of redirecting to ${show(canonical.origin)}, creating a duplicate copy of every page.`
  );
  add(
    "hosts-multi-hop",
    "Address variants that take several redirects",
    "info",
    slow,
    "Each variant should redirect to the main address in a single hop."
  );
  add(
    "hosts-no-dns",
    "Address variants that don't exist",
    "info",
    missingDns,
    "Anyone typing this variant gets an error. Usually worth adding a DNS record that redirects to the main address."
  );

  const main = hosts.find((h) => new URL(h.url).origin === canonical.origin);
  if (canonical.protocol === "https:" && main && !main.error && !main.hsts) {
    findings.push({
      id: "hsts-missing",
      title: "No HSTS header",
      severity: "info",
      category: "status",
      description: "The site doesn't send Strict-Transport-Security, which tells browsers to always use https. A small security hardening step.",
      urls: [main.url],
    });
  }
  return findings;
}
