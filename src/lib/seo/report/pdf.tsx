/**
 * The PDF summary of an audit, drawn with @react-pdf/renderer from a
 * ReportModel (model.ts). ~8–15 pages: cover, summary, one section per
 * stage, method and limits. The full URL lists live in the Excel workbook
 * that downloads alongside it — this document says so wherever it trims.
 *
 * Generated in the browser (loaded only when someone clicks Download), so
 * fonts are fetched from this site's /fonts/report/ — `registerReportFonts`
 * takes the base to resolve against (window.location.origin in the browser,
 * a file path in tests).
 *
 * Brand comes from the ReportBrand config (Velocity B by default); nothing
 * here should name a brand directly.
 */

import { Document, Font, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Severity } from "@/lib/seo/findings";
import type { Rating } from "@/lib/seo/speed";
import type { StageMetric } from "@/app/admin/(protected)/seo/stages";
import type { ReportBrand } from "./brand";
import { GUIDE_URL } from "@/lib/seo/guidance";
import { SEVERITY_LABEL, type ReportFinding, type ReportModel, type ReportSection } from "./model";

// ------------------------------------------------------------ fonts

const registered = new Set<string>();

export function registerReportFonts(brand: ReportBrand, resolve: (src: string) => string): void {
  for (const f of [brand.fonts.display, brand.fonts.body]) {
    if (registered.has(f.family)) continue;
    Font.register({ family: f.family, fonts: f.faces.map((face) => ({ src: resolve(face.src), fontWeight: face.fontWeight })) });
    registered.add(f.family);
  }
  // No automatic hyphenation: it splits URLs and product names oddly.
  Font.registerHyphenationCallback((word) => [word]);
}

// ------------------------------------------------------------ layout safety

/**
 * Blocks we'd rather not split across pages (a finding's heading, the
 * summary panels) are marked unbreakable. react-pdf 4.9 can fail on some
 * page-break arrangements of unbreakable blocks ("unsupported number:
 * -1.7e+21" from pdfkit) — hit on a full contentbloom.com audit, where every
 * section rendered fine alone but not together. So: finding bodies are
 * breakable, only small heads are kept together, and download.ts retries
 * with `safeLayout` (nothing unbreakable) if a render still fails.
 * Set by ReportDocument before its children render (rendering is
 * synchronous and one document at a time).
 */
let safeLayout = false;
const keep = (): { wrap?: false } => (safeLayout ? {} : { wrap: false });

// ------------------------------------------------------------ text helpers

/**
 * The bundled fonts are the Latin subset; swap the few symbols the audit's
 * own notes use for ones the fonts have.
 */
function t(s: string | null | undefined): string {
  return (s ?? "").replace(/\s*→\s*/g, " to ").replace(/≥/g, ">=").replace(/≤/g, "<=");
}

function shortUrl(url: string, origin: string, max = 95): string {
  let s = url;
  try {
    const u = new URL(url);
    // Exact origin only: a different host (apex vs www) is often the point
    // of the finding, so those URLs are shown in full.
    if (u.origin === origin) {
      s = (u.pathname + u.search) || "/";
    }
  } catch {
    // keep as-is
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const n = (x: number) => x.toLocaleString("en-GB");

// ------------------------------------------------------------ styles

function makeStyles(b: ReportBrand) {
  const c = b.colors;
  const display = b.fonts.display.family;
  const body = b.fonts.body.family;
  return StyleSheet.create({
    page: { fontFamily: body, fontSize: 9.5, color: c.text, paddingTop: 48, paddingBottom: 56, paddingHorizontal: 44, lineHeight: 1.4 },
    cover: { backgroundColor: c.primary, color: "#FFFFFF", padding: 56, fontFamily: body },
    footer: {
      position: "absolute",
      bottom: 24,
      left: 44,
      right: 44,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: 7.5,
      color: c.muted,
      borderTopWidth: 0.5,
      borderTopColor: c.hairline,
      paddingTop: 6,
    },
    h1: { fontFamily: display, fontWeight: 700, fontSize: 22, lineHeight: 1.2, color: c.primary, marginBottom: 6 },
    h2: { fontFamily: display, fontWeight: 700, fontSize: 16, lineHeight: 1.25, color: c.primary, marginBottom: 2 },
    h3: { fontFamily: display, fontWeight: 500, fontSize: 11, lineHeight: 1.25, color: c.primary },
    lead: { fontSize: 10.5, color: c.muted, marginBottom: 14 },
    muted: { color: c.muted },
    small: { fontSize: 8, color: c.muted },
    label: { fontSize: 7, letterSpacing: 0.8, textTransform: "uppercase", color: c.muted, fontWeight: 600 },
    rule: { height: 3, width: 36, backgroundColor: c.accent, marginBottom: 10 },
    panel: { backgroundColor: c.panel, borderRadius: 4, padding: 12 },
    tiles: { flexDirection: "row", gap: 8, marginBottom: 14 },
    tile: { flex: 1, borderWidth: 0.75, borderColor: c.hairline, borderRadius: 4, padding: 10 },
    tileValue: { fontFamily: display, fontWeight: 700, fontSize: 18, color: c.primary, marginTop: 2 },
    finding: { borderTopWidth: 0.5, borderTopColor: c.hairline, paddingTop: 9, marginTop: 9 },
    findingHead: { flexDirection: "row", alignItems: "center", gap: 6 },
    pill: { fontSize: 6.5, fontWeight: 600, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 6, letterSpacing: 0.4, textTransform: "uppercase" },
    count: { marginLeft: "auto", fontFamily: display, fontWeight: 500, fontSize: 10, color: c.primary },
    twoCol: { flexDirection: "row", gap: 14, marginTop: 5 },
    col: { flex: 1 },
    example: { marginTop: 2.5, fontSize: 8 },
    banner: { backgroundColor: "#FFF4E8", borderLeftWidth: 3, borderLeftColor: c.secondAccent, padding: 9, marginBottom: 12, fontSize: 9 },
    link: { color: c.primary, textDecoration: "underline" },
  });
}
type Styles = ReturnType<typeof makeStyles>;

const SEV_COLORS: Record<Severity, { bg: string; fg: string }> = {
  error: { bg: "#FDE4E4", fg: "#A31B1B" },
  warning: { bg: "#FFF0DC", fg: "#9A4A00" },
  info: { bg: "#E3EEFC", fg: "#1D4F91" },
};

const RATING_COLOR: Record<Rating, string> = { good: "#18794E", ni: "#9A4A00", poor: "#A31B1B" };
const toneColor = (tone: StageMetric["tone"], fallback: string) =>
  tone === "bad" ? "#A31B1B" : tone === "warn" ? "#9A4A00" : tone === "good" ? "#18794E" : fallback;

// ------------------------------------------------------------ pieces

function Logo({ brand, onDark }: { brand: ReportBrand; onDark?: boolean }) {
  const circle = onDark ? "#FFFFFF" : brand.colors.primary;
  const letters = onDark ? brand.colors.primary : "#FFFFFF";
  const word = onDark ? "#FFFFFF" : brand.colors.primary;
  const display = brand.fonts.display.family;
  // Mirrors velocity-b's components/Logo.tsx: a circle with a rotated "V"
  // and a "B", then the wordmark.
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: circle, position: "relative" }}>
        <Text
          style={{
            position: "absolute",
            left: 4.5,
            top: 8,
            fontFamily: display,
            fontWeight: 700,
            fontSize: 10,
            color: letters,
            transform: "rotate(-90deg)",
          }}
        >
          V
        </Text>
        <Text style={{ position: "absolute", left: 13.5, top: 6, fontFamily: display, fontWeight: 700, fontSize: 14, color: letters }}>B</Text>
      </View>
      <Text style={{ fontFamily: display, fontWeight: 500, fontSize: 15, color: word }}>{brand.name}</Text>
    </View>
  );
}

function Footer({ model, s }: { model: ReportModel; s: Styles }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        Technical SEO audit · {model.host} · {model.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${model.brand.name} · page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function SeverityPill({ severity, s }: { severity: Severity; s: Styles }) {
  const col = SEV_COLORS[severity];
  return <Text style={[s.pill, { backgroundColor: col.bg, color: col.fg }]}>{SEVERITY_LABEL[severity]}</Text>;
}

function Tile({ label, value, color, s }: { label: string; value: string; color?: string; s: Styles }) {
  return (
    <View style={s.tile}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.tileValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

function PartialBanner({ reasons, s }: { reasons: string[]; s: Styles }) {
  if (!reasons.length) return null;
  return (
    <View style={s.banner} {...keep()}>
      <Text style={{ fontWeight: 600, marginBottom: 2 }}>Partial audit</Text>
      {reasons.map((r) => (
        <Text key={r}>{t(r)}</Text>
      ))}
    </View>
  );
}

function FindingBlock({ f, model, s, compact }: { f: ReportFinding; model: ReportModel; s: Styles; compact: boolean }) {
  const more = f.count - f.examples.length;
  const guide = (label: string) =>
    f.guideUrl ? (
      <>
        {" "}
        <Link src={f.guideUrl} style={s.link}>
          {label}
        </Link>
      </>
    ) : null;
  return (
    <View style={s.finding}>
      {/* Heading, description and why/how kept together; the example list may run onto the next page. */}
      <View {...keep()}>
        <View style={s.findingHead}>
          <SeverityPill severity={f.severity} s={s} />
          <Text style={s.h3}>{t(f.title)}</Text>
          {f.count > 0 && <Text style={s.count}>{n(f.count)}</Text>}
        </View>
        {compact && (
          <Text style={[s.small, { marginTop: 3 }]}>
            {t(f.how ?? f.description)}
            {guide("Guide")}
          </Text>
        )}
        {!compact && <Text style={[s.muted, { marginTop: 3 }]}>{t(f.description)}</Text>}
        {!compact && (f.why || f.how) && (
          <View style={s.twoCol}>
            {f.why && (
              <View style={s.col}>
                <Text style={s.label}>Why it matters</Text>
                <Text style={{ marginTop: 1 }}>{t(f.why)}</Text>
              </View>
            )}
            {f.how && (
              <View style={s.col}>
                <Text style={s.label}>How to fix</Text>
                <Text style={{ marginTop: 1 }}>
                  {t(f.how)}
                  {guide("More in the guide")}
                </Text>
              </View>
            )}
          </View>
        )}
        {!compact && f.caveat && <Text style={[s.small, { marginTop: 4 }]}>Note: {t(f.caveat)}</Text>}
      </View>
      {!compact && f.examples.length > 0 && (
        <View style={{ marginTop: 5 }}>
          <Text style={s.label}>{f.count > f.examples.length ? `Examples (${f.examples.length} of ${n(f.count)})` : "Affected"}</Text>
          {f.examples.map((ex) => (
            <View key={ex.url} style={s.example}>
              <Text style={{ color: model.brand.colors.primary }}>{t(shortUrl(ex.url, model.origin))}</Text>
              {(ex.note || ex.source) && (
                <Text style={[s.muted, { fontSize: 7.5, marginLeft: 8 }]}>
                  {t(ex.note)}
                  {ex.source
                    ? `${ex.note ? " · " : ""}linked from ${t(shortUrl(ex.source.page, model.origin, 70))}${ex.source.text ? ` ("${t(ex.source.text).slice(0, 60)}")` : ""}`
                    : ""}
                </Text>
              )}
            </View>
          ))}
          {more > 0 && (
            <Text style={[s.small, { marginTop: 2 }]}>+ {n(more)} more — every URL is listed in the workbook (Findings tab).</Text>
          )}
        </View>
      )}
    </View>
  );
}

function StageSection({ section, model, s }: { section: ReportSection; model: ReportModel; s: Styles }) {
  const main = section.findings.filter((f) => f.severity !== "info");
  const notices = section.findings.filter((f) => f.severity === "info");
  const c = model.brand.colors;
  return (
    <View style={{ marginBottom: 22 }}>
      <View {...keep()}>
        <View style={s.rule} />
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text style={s.h2}>{section.title}</Text>
          <Text style={s.small}>
            {section.counts.error} errors · {section.counts.warning} warnings · {section.counts.info} notices
            {section.status === "skipped" ? " · not run" : section.status === "stopped" ? " · stopped early" : ""}
          </Text>
        </View>
        <Text style={[s.muted, { marginBottom: 8 }]}>{section.blurb}</Text>
        {section.metrics.length > 0 && (
          <View style={[s.tiles, { marginBottom: 4 }]}>
            {section.metrics.map((m) => (
              <View key={m.label} style={[s.tile, { padding: 7 }]}>
                <Text style={s.label}>{m.label}</Text>
                <Text style={{ fontFamily: model.brand.fonts.display.family, fontWeight: 700, fontSize: 12, color: toneColor(m.tone, c.primary) }}>
                  {t(m.value)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {section.findings.length === 0 && (
        <Text style={[s.muted, { marginTop: 6 }]}>
          {section.status === "skipped" ? "This stage wasn't run for this audit." : "No issues found in this stage."}
        </Text>
      )}
      {main.map((f) => (
        <FindingBlock key={f.id} f={f} model={model} s={s} compact={false} />
      ))}
      {notices.length > 0 && (
        <View>
          <Text style={[s.label, { marginTop: 12 }]}>
            Notices — worth knowing, often no action needed
          </Text>
          {notices.map((f) => (
            <FindingBlock key={f.id} f={f} model={model} s={s} compact />
          ))}
        </View>
      )}
    </View>
  );
}

// ------------------------------------------------------------ document

export function ReportDocument({ model, safe = false }: { model: ReportModel; safe?: boolean }) {
  safeLayout = safe;
  const s = makeStyles(model.brand);
  const b = model.brand;
  const date = model.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const tot = model.totals;
  const sp = model.speed;

  return (
    <Document title={`Technical SEO audit — ${model.host}`} author={b.name} creator={b.name} producer={b.name} language="en-GB">
      {/* Cover */}
      <Page size="A4" style={s.cover}>
        <Logo brand={b} onDark />
        <View style={{ marginTop: 190 }}>
          <View style={{ height: 3, width: 48, backgroundColor: b.colors.accent, marginBottom: 16 }} />
          <Text style={{ fontFamily: b.fonts.display.family, fontWeight: 500, fontSize: 14, color: b.colors.accent }}>Technical SEO audit</Text>
          <Text style={{ fontFamily: b.fonts.display.family, fontWeight: 700, fontSize: 34, marginTop: 6 }}>{model.host}</Text>
          <Text style={{ fontSize: 11, marginTop: 14, color: "#C9CEE0" }}>
            {date} · {n(model.pagesCrawled)} pages crawled
          </Text>
          {model.partial.length > 0 && (
            <Text
              style={{
                marginTop: 14,
                alignSelf: "flex-start",
                backgroundColor: b.colors.secondAccent,
                color: b.colors.primary,
                fontWeight: 600,
                fontSize: 9,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 8,
              }}
            >
              Partial audit — see summary
            </Text>
          )}
        </View>
        <View style={{ position: "absolute", bottom: 56, left: 56, right: 56 }}>
          <Text style={{ fontSize: 9, color: "#C9CEE0" }}>
            Prepared by {b.name} · {b.websiteLabel}
          </Text>
          <Text style={{ fontSize: 8, color: "#8F97B5", marginTop: 4 }}>
            Full detail in the accompanying workbook. Fix guidance for every item: {GUIDE_URL.replace(/^https:\/\//, "")}
          </Text>
        </View>
      </Page>

      {/* Summary */}
      <Page size="A4" style={s.page}>
        <View style={s.rule} />
        <Text style={s.h1}>Summary</Text>
        <Text style={s.lead}>
          {model.startUrl} · audited {date} · {n(model.pagesCrawled)} pages · took {model.durationText}
        </Text>
        <Text style={[s.small, { marginTop: -8, marginBottom: 12 }]}>
          This summary covers each stage with examples. The accompanying workbook (.xlsx) lists every affected URL,
          page and link, ready to sort and filter. Fix guidance for every item: {GUIDE_URL.replace(/^https:\/\//, "")}
        </Text>
        <PartialBanner reasons={model.partial} s={s} />
        <View style={s.tiles}>
          <Tile label="Errors" value={n(tot.errors)} color={tot.errors ? SEV_COLORS.error.fg : undefined} s={s} />
          <Tile label="Warnings" value={n(tot.warnings)} color={tot.warnings ? SEV_COLORS.warning.fg : undefined} s={s} />
          <Tile label="Notices" value={n(tot.notices)} s={s} />
          <Tile label="Broken links" value={n(tot.brokenLinks)} color={tot.brokenLinks ? SEV_COLORS.error.fg : undefined} s={s} />
        </View>
        <Text style={[s.small, { marginTop: -8, marginBottom: 14 }]}>
          Counts are per affected URL: one issue on 10 pages counts as 10. Errors are worth fixing first; warnings are
          worth planning; notices are often fine as they are.
        </Text>

        {sp && (
          <View style={[s.panel, { marginBottom: 16 }]} {...keep()}>
            <Text style={[s.h3, { marginBottom: 6 }]}>Page speed (mobile)</Text>
            <View style={{ flexDirection: "row", gap: 18 }}>
              <View>
                <Text style={s.label}>Site score</Text>
                <Text style={[s.tileValue, sp.scoreRating ? { color: RATING_COLOR[sp.scoreRating] } : {}]}>
                  {sp.score === null ? "—" : sp.score}
                  <Text style={{ fontSize: 9, color: b.colors.muted }}> / 100</Text>
                </Text>
              </View>
              <View>
                <Text style={s.label}>Median LCP</Text>
                <Text style={[s.tileValue, sp.lcpRating ? { color: RATING_COLOR[sp.lcpRating] } : {}]}>{sp.lcp}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Real visitors (phones)</Text>
                <Text style={{ marginTop: 4 }}>
                  {!sp.field
                    ? "Not looked up."
                    : !sp.field.found
                      ? "Not enough real-visitor data in Google's Chrome UX Report — normal for smaller sites."
                      : `LCP ${sp.field.lcp} · INP ${sp.field.inp} · CLS ${sp.field.cls} (28-day, 75th percentile)`}
                </Text>
              </View>
            </View>
            <Text style={[s.small, { marginTop: 6 }]}>
              Median of {sp.tested} sampled pages (from {n(sp.indexable)} indexable). Lab scores vary between runs, so
              small differences are noise.
            </Text>
          </View>
        )}

        <Text style={[s.h2, { marginBottom: 2 }]}>What to fix first</Text>
        {model.topIssues.length === 0 ? (
          <Text style={[s.muted, { marginTop: 4 }]}>No errors or warnings — nothing urgent to fix.</Text>
        ) : (
          model.topIssues.map((f, i) => (
            <View key={f.id} style={[s.finding, { flexDirection: "row", gap: 10 }]} {...keep()}>
              <Text style={{ fontFamily: b.fonts.display.family, fontWeight: 700, fontSize: 16, color: b.colors.accent, width: 14 }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <View style={s.findingHead}>
                  <SeverityPill severity={f.severity} s={s} />
                  <Text style={s.h3}>{t(f.title)}</Text>
                  {f.count > 0 && <Text style={s.count}>{n(f.count)}</Text>}
                </View>
                <Text style={[s.small, { marginTop: 1 }]}>{f.stageTitle}</Text>
                {f.how && <Text style={{ marginTop: 3 }}>{t(f.how)}</Text>}
              </View>
            </View>
          ))
        )}

        <Footer model={model} s={s} />
      </Page>

      {/* Stage sections */}
      <Page size="A4" style={s.page}>
        {model.sections.map((section) => (
          <StageSection key={section.id} section={section} model={model} s={s} />
        ))}
        <Footer model={model} s={s} />
      </Page>

      {/* Method and limits */}
      <Page size="A4" style={s.page}>
        <View style={s.rule} />
        <Text style={s.h1}>Method and limits</Text>
        <Text style={s.lead}>How the audit worked, and what it can't see.</Text>
        {model.method.map((m) => (
          <View key={m} style={{ flexDirection: "row", gap: 6, marginBottom: 5 }}>
            <Text style={{ color: b.colors.accent }}>•</Text>
            <Text style={{ flex: 1 }}>{t(m)}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 5 }}>
          <Text style={{ color: b.colors.accent }}>•</Text>
          <Text style={{ flex: 1 }}>
            This audit: up to {n(model.pageLimit)} pages; external links {model.checkExternal ? "checked" : "not checked"}
            ; {n(model.pagesCrawled)} pages crawled in {model.durationText}.
          </Text>
        </View>
        {model.coverage.length > 0 && (
          <>
            <Text style={[s.h3, { marginTop: 14, marginBottom: 4 }]}>About this audit&apos;s coverage</Text>
            {model.coverage.map((c) => (
              <View key={c.title} style={{ marginBottom: 6 }}>
                <Text style={{ fontWeight: 600 }}>{t(c.title)}</Text>
                <Text style={s.muted}>{t(c.line)}</Text>
              </View>
            ))}
          </>
        )}
        <PartialBanner reasons={model.partial} s={s} />
        <Footer model={model} s={s} />
      </Page>
    </Document>
  );
}
