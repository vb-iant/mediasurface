/**
 * Content scan download, v1 (Ian, 2026-10-13: "start simply with a topic
 * map"): one Excel file — About, Topics (per section and site-wide), and
 * Pages (each page's focus phrase, so the map can be traced). Written with
 * the same hand-rolled SpreadsheetML writer as the audit workbook, so the
 * formula-injection guard applies to every cell from the client's site.
 */

import type { AuditResult } from "../types";
import type { CellValue, WorkbookData } from "../report/model";
import { hostOf } from "../report/model";
import { FIELD_LABEL, type Clarity, type ContentModel } from "./model";

export const CLARITY_LABEL: Record<Clarity, string> = {
  clear: "Clear",
  mixed: "Mixed signals",
  weak: "Weak",
  none: "No clear phrase",
};

export function buildTopicWorkbook(audit: AuditResult, model: ContentModel, partial: string | null, now = new Date()): WorkbookData {
  const about: CellValue[][] = [
    ["Site", audit.discovery.startUrl],
    ["Scanned", new Date(audit.startedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })],
    ["Status", partial ?? "Complete"],
    ["Pages crawled", audit.pages.length],
    ["Pages analysed", model.pages.length],
    ["Not analysed", `${model.skipped} (redirects, errors, noindex, filtered or paginated listings, declared duplicates)`],
    ["Left out as brand / boilerplate", model.boilerplate.join(", ") || "—"],
    ["How phrases are found", "From each page's title, H1, URL, meta description, subheadings and opening paragraph, plus its main text (navigation, header and footer excluded). Phrases on nearly every page are left out; phrases common across the site are weighted down. People's names from author and team pages are left out of the topic map."],
    ["Limits", "English only. Shows what the site's own content says it's about — not search volume, keyword difficulty or rankings, which need Google Search Console or a paid tool."],
    ["Generated", now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })],
  ];

  const topicRows: CellValue[][] = [];
  const pushTopics = (section: string, pageCount: number, phrases: ContentModel["site"]) => {
    phrases.forEach((t, i) => topicRows.push([section, pageCount, i + 1, t.text, t.pages, t.examples.join("\n")]));
  };
  pushTopics("Whole site", model.pages.length, model.site);
  for (const s of model.sections) pushTopics(s.label, s.pageCount, s.phrases);

  const pageRows: CellValue[][] = model.pages.map((p) => [
    p.url,
    p.section,
    p.title ?? "",
    p.h1 ?? "",
    p.focus ?? "",
    CLARITY_LABEL[p.clarity],
    p.focusFields.map((f) => FIELD_LABEL[f]).join(", "),
    p.alsoAbout.join(", "),
    p.mixed ?? "",
    p.words,
  ]);

  return {
    sheets: [
      { name: "About", columns: [{ header: "Item", width: 28 }, { header: "Value", width: 100 }], rows: about },
      {
        name: "Topics",
        columns: [
          { header: "Section", width: 22 },
          { header: "Pages in section", width: 10, kind: "number" },
          { header: "Rank", width: 6, kind: "number" },
          { header: "Phrase", width: 30 },
          { header: "Pages naming it", width: 10, kind: "number" },
          { header: "Example pages", width: 70 },
        ],
        rows: topicRows,
      },
      {
        name: "Pages",
        columns: [
          { header: "URL", width: 60, kind: "url" },
          { header: "Section", width: 18 },
          { header: "Title", width: 45 },
          { header: "H1", width: 45 },
          { header: "Focus phrase", width: 28 },
          { header: "Clarity", width: 14 },
          { header: "Focus found in", width: 40 },
          { header: "Also about", width: 45 },
          { header: "Mixed signals", width: 60 },
          { header: "Main-text words", width: 10, kind: "number" },
        ],
        rows: pageRows,
      },
    ],
  };
}

export function topicFileStem(audit: AuditResult, now = new Date()): string {
  return `${hostOf(audit.discovery.startUrl)}-topic-map-${now.toISOString().slice(0, 10)}`;
}
