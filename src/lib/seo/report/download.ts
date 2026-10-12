/**
 * Builds the downloadable report in the browser: PDF summary + Excel
 * workbook, zipped as `<host>-seo-audit-<date>.zip`, or either file alone
 * (fallback for mail gateways that quarantine zips). Nothing is uploaded or
 * stored — the files are made from the audit already in this tab.
 *
 * The heavy libraries (@react-pdf/renderer, fflate) are imported here, and
 * this module is itself loaded with `import()` on click, so the admin's
 * normal pages don't carry them.
 */

import { createElement } from "react";
import type { AuditResult } from "@/lib/seo/types";
import { computeFindings } from "@/lib/seo/findings";
import { VELOCITY_B_BRAND, type ReportBrand } from "./brand";
import { buildReportModel, buildWorkbook, reportFileStem, type AuditPhaseLike } from "./model";

export type ReportPart = "zip" | "pdf" | "xlsx";

export interface ReportInput {
  audit: AuditResult;
  phase: AuditPhaseLike;
  checkExternal: boolean;
  brand?: ReportBrand;
}

async function makePdf(input: ReportInput, brand: ReportBrand): Promise<Uint8Array> {
  const [{ pdf }, { ReportDocument, registerReportFonts }] = await Promise.all([import("@react-pdf/renderer"), import("./pdf")]);
  registerReportFonts(brand, (src) => new URL(src, window.location.origin).toString());
  const model = buildReportModel(input.audit, input.phase, { checkExternal: input.checkExternal }, brand, computeFindings(input.audit));
  // ReportDocument returns a <Document>; pdf() wants that element.
  const render = async (safe: boolean) => {
    const doc = createElement(ReportDocument, { model, safe }) as unknown as Parameters<typeof pdf>[0];
    const blob = await pdf(doc).toBlob();
    return new Uint8Array(await blob.arrayBuffer());
  };
  try {
    return await render(false);
  } catch (e) {
    // See "layout safety" in pdf.tsx: retry with every block breakable.
    console.warn("PDF layout failed, retrying with breakable blocks:", e);
    return render(true);
  }
}

async function makeXlsx(input: ReportInput, brand: ReportBrand): Promise<Uint8Array> {
  const { buildXlsx } = await import("./xlsx");
  const book = buildWorkbook(input.audit, input.phase, { checkExternal: input.checkExternal }, brand, computeFindings(input.audit));
  return buildXlsx(book, {
    title: `Technical SEO audit — ${reportFileStem(input.audit)}`,
    creator: brand.name,
    created: new Date(),
  });
}

function save(bytes: Uint8Array, filename: string, type: string): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const PDF_TYPE = "application/pdf";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function downloadReport(input: ReportInput, part: ReportPart): Promise<void> {
  const brand = input.brand ?? VELOCITY_B_BRAND;
  const stem = reportFileStem(input.audit);
  if (part === "pdf") return save(await makePdf(input, brand), `${stem}.pdf`, PDF_TYPE);
  if (part === "xlsx") return save(await makeXlsx(input, brand), `${stem}.xlsx`, XLSX_TYPE);
  const [pdfBytes, xlsxBytes, { zipSync }] = await Promise.all([makePdf(input, brand), makeXlsx(input, brand), import("fflate")]);
  // Both files are already compressed; store them rather than deflate again.
  const zip = zipSync({ [`${stem}.pdf`]: [pdfBytes, { level: 0 }], [`${stem}.xlsx`]: [xlsxBytes, { level: 0 }] });
  save(zip, `${stem}.zip`, "application/zip");
}
