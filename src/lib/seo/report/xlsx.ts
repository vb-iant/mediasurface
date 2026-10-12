/**
 * Minimal .xlsx writer for the audit workbook: SpreadsheetML parts zipped
 * with fflate. Written by hand rather than pulling in exceljs (~1 MB, built
 * for Node streams, awkward to bundle for the browser) or SheetJS (no
 * longer published to npm). The workbook needs very little: text and number
 * cells, a styled header row, frozen header, filters, column widths and
 * clickable URLs.
 *
 * Safety: page titles, link text and URLs come from the audited site, so
 * nothing from the data is ever written as a formula. Every text value is an
 * inline string (`t="inlineStr"`), which Excel and Google Sheets never
 * evaluate; values starting with = + - @ also get `quotePrefix`, so they stay
 * text even if someone edits the cell. That's the formula-injection guard
 * the CTRL task asked for (tm-1791827456432).
 */

import { strToU8, zipSync } from "fflate";
import type { CellValue, SheetData, WorkbookData } from "./model";

const MAX_CELL_CHARS = 32767;
/** Excel's per-sheet hyperlink limit is 65,530; stay under it. */
const MAX_HYPERLINKS = 60000;

// Style indexes into cellXfs below.
const S_DEFAULT = 0;
const S_HEADER = 1;
const S_LINK = 2;
const S_QUOTED = 3;
const S_WRAP = 4;

function xmlEscape(s: string): string {
  return (
    s
      // Characters XML 1.0 doesn't allow at all.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const isHttpUrl = (v: string) => /^https?:\/\/[^\s"<>]+$/i.test(v) && v.length < 2000;

function textCell(ref: string, value: string, style: number): string {
  const v = value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS - 1) + "…" : value;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
}

function sheetXml(sheet: SheetData, wrapLastColumn: boolean): { xml: string; rels: string | null } {
  const links: { ref: string; target: string }[] = [];
  const rows: string[] = [];
  const header = sheet.columns.map((c, i) => textCell(`${colName(i)}1`, c.header, S_HEADER)).join("");
  rows.push(`<row r="1">${header}</row>`);

  sheet.rows.forEach((row, ri) => {
    const r = ri + 2;
    const cells: string[] = [];
    row.forEach((value: CellValue, ci) => {
      if (value === null || value === undefined || value === "") return;
      const ref = `${colName(ci)}${r}`;
      if (typeof value === "number") {
        if (Number.isFinite(value)) cells.push(`<c r="${ref}" s="${S_DEFAULT}"><v>${value}</v></c>`);
        return;
      }
      const col = sheet.columns[ci];
      if (col?.kind === "url" && isHttpUrl(value) && links.length < MAX_HYPERLINKS) {
        links.push({ ref, target: value });
        cells.push(textCell(ref, value, S_LINK));
      } else if (/^[=+\-@\t\r]/.test(value)) {
        cells.push(textCell(ref, value, S_QUOTED));
      } else {
        cells.push(textCell(ref, value, wrapLastColumn && ci === sheet.columns.length - 1 ? S_WRAP : S_DEFAULT));
      }
    });
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
  });

  const lastCol = colName(Math.max(0, sheet.columns.length - 1));
  const lastRow = sheet.rows.length + 1;
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(120, Math.max(6, c.width))}" customWidth="1"/>`)
    .join("");
  const hyperlinks = links.length
    ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join("")}</hyperlinks>`
    : "";

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    (sheet.rows.length ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : "") +
    hyperlinks +
    `</worksheet>`;

  const rels = links.length
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      links
        .map(
          (l, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(l.target)}" TargetMode="External"/>`
        )
        .join("") +
      `</Relationships>`
    : null;
  return { xml, rels };
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="3">` +
  `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><u/><sz val="11"/><color rgb="FF1F5FBF"/><name val="Calibri"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF0A1543"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="5">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Sheet names: ≤31 chars, no []:*?/\ — ours are fixed, but keep it safe. */
function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
}

export function buildXlsx(book: WorkbookData, meta: { title: string; creator: string; created: Date }): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const sheets = book.sheets;

  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join("") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `</Types>`
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`
  );
  files["docProps/core.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xmlEscape(meta.title)}</dc:title><dc:creator>${xmlEscape(meta.creator)}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${meta.created.toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created>` +
      `</cp:coreProperties>`
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(safeSheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      `<definedNames>${sheets
        .map((s, i) =>
          s.rows.length
            ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEscape(safeSheetName(s.name))}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>`
            : ""
        )
        .join("")}</definedNames>` +
      `</workbook>`
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  );
  files["xl/styles.xml"] = strToU8(STYLES);
  sheets.forEach((s, i) => {
    const { xml, rels } = sheetXml(s, s.name === "About");
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
    if (rels) files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(rels);
  });

  return zipSync(files, { level: 6 });
}
