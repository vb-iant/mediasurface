/**
 * Phase 5b: page speed findings, from the sampled Lighthouse runs and the
 * Chrome UX Report. Sample-based, so the wording says "of the pages tested".
 */

import { formatCls, formatMs, rate } from "../speed";
import type { AuditResult, FieldMetrics } from "../types";
import type { Finding } from "./types";

function fieldSummary(f: FieldMetrics): { poor: string[]; ni: string[] } {
  const poor: string[] = [];
  const ni: string[] = [];
  const check = (label: string, r: ReturnType<typeof rate>, shown: string) => {
    if (r === "poor") poor.push(`${label} ${shown}`);
    else if (r === "ni") ni.push(`${label} ${shown}`);
  };
  check("LCP", rate("lcp", f.lcp), formatMs(f.lcp));
  check("INP", rate("inp", f.inp), formatMs(f.inp));
  check("CLS", rate("cls", f.cls), formatCls(f.cls));
  return { poor, ni };
}

export function speedFindings(audit: AuditResult): Finding[] {
  const speed = audit.speed;
  if (!speed) return [];
  const findings: Finding[] = [];
  const results = speed.results;
  const note = (r: (typeof results)[number]) => `Score ${r.score} · LCP ${formatMs(r.lcp)} · CLS ${formatCls(r.cls)} · TBT ${formatMs(r.tbt)}`;

  const poor = results.filter((r) => r.score !== null && r.score < 50).sort((a, b) => a.score! - b.score!);
  if (poor.length) {
    findings.push({
      id: "speed-poor",
      title: "Slow pages on mobile",
      severity: "warning",
      category: "speed",
      description:
        "These tested pages score under 50 in Lighthouse's mobile test (a simulated mid-range phone on a slow connection). Pages of the same type usually share the cause — run a speed diagnosis on one to see what to fix.",
      urls: poor.map((r) => r.url),
      notes: Object.fromEntries(poor.map((r) => [r.url, note(r)])),
    });
  }
  const middling = results.filter((r) => r.score !== null && r.score >= 50 && r.score < 90).sort((a, b) => a.score! - b.score!);
  if (middling.length) {
    findings.push({
      id: "speed-needs-work",
      title: "Pages that could be faster on mobile",
      severity: "info",
      category: "speed",
      description: "These tested pages score 50–89 in Lighthouse's mobile test. 90 or more counts as good.",
      urls: middling.map((r) => r.url),
      notes: Object.fromEntries(middling.map((r) => [r.url, note(r)])),
    });
  }
  const failed = results.filter((r) => r.score === null);
  if (failed.length) {
    findings.push({
      id: "speed-failed",
      title: "Pages that couldn't be speed-tested",
      severity: "info",
      category: "speed",
      description: "PageSpeed Insights couldn't test these pages. Often temporary — run a speed diagnosis to try again.",
      urls: failed.map((r) => r.url),
      notes: Object.fromEntries(failed.map((r) => [r.url, r.error ?? "Unknown error"])),
    });
  }

  const phone = speed.field?.phone;
  if (phone) {
    const { poor: bad, ni } = fieldSummary(phone);
    if (bad.length || ni.length) {
      findings.push({
        id: bad.length ? "field-poor" : "field-needs-work",
        title: bad.length ? "Real mobile visitors get a poor experience" : "Real mobile visitors' experience needs improvement",
        severity: bad.length ? "warning" : "info",
        category: "speed",
        description:
          "From the Chrome UX Report — what real Chrome users on phones experienced across the whole site over the last 28 days (75th percentile). This is the data Google uses for its page experience signals.",
        urls: [],
        caveat: [...bad.map((s) => `Poor: ${s}`), ...ni.map((s) => `Needs improvement: ${s}`)].join(" · "),
      });
    }
  }

  return findings;
}
