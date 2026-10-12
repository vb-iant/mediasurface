"use client";

/**
 * "Client report" panel on the audit overview: downloads the PDF summary +
 * Excel workbook as one zip, or either file on its own. Available once the
 * audit has finished or been stopped (a stopped audit gets a "partial"
 * banner in both files). The generator is loaded on click so the admin
 * pages don't carry the PDF library.
 */

import { useState } from "react";
import { isActive, type AuditRecord } from "./audit-store";
import type { ReportPart } from "@/lib/seo/report/download";
import { card, muted } from "./report";

const LABEL: Record<ReportPart, string> = { zip: "report", pdf: "PDF", xlsx: "workbook" };

export function ReportDownload({ record }: { record: AuditRecord }) {
  const [busy, setBusy] = useState<ReportPart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audit = record.audit;
  if (!audit || isActive(record)) return null;
  const partial = audit.capReached || record.phase === "stopped" || record.phase === "error" || audit.status !== "complete";

  const run = async (part: ReportPart) => {
    setBusy(part);
    setError(null);
    try {
      const { downloadReport } = await import("@/lib/seo/report/download");
      await downloadReport({ audit, phase: record.phase, checkExternal: record.options.checkExternal }, part);
    } catch (e) {
      setError(`Couldn't create the ${LABEL[part]}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const linkBtn =
    "text-xs font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50";

  return (
    <section className={`${card} mt-6 px-4 py-4`} aria-label="Client report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Client report</h2>
          <p className={`mt-0.5 text-xs ${muted}`}>
            Velocity B-branded PDF summary + Excel workbook with every URL, in one zip.
            {partial && " This audit didn't finish, so both files are marked as partial."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => run("zip")}
            disabled={busy !== null}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy === "zip" ? "Creating…" : "Download report (.zip)"}
          </button>
          <span className={`text-xs ${muted}`}>
            or{" "}
            <button type="button" onClick={() => run("pdf")} disabled={busy !== null} className={linkBtn}>
              {busy === "pdf" ? "creating…" : "PDF only"}
            </button>{" "}
            ·{" "}
            <button type="button" onClick={() => run("xlsx")} disabled={busy !== null} className={linkBtn}>
              {busy === "xlsx" ? "creating…" : "Excel only"}
            </button>
          </span>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
