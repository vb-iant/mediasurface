/**
 * Per-site OG-image template config. The design goal: everything that
 * varies between sites is a VALUE here (a color-variable name, a single
 * glyph, a font URL), not a JSX/SVG structure — Velocity B's actual
 * chevron watermark is bespoke hand-drawn SVG, which doesn't fit this
 * shape, so this config deliberately narrows "background motif" down to
 * "one ghosted character," which does. See CTRL (Mediasurface Admin
 * board) for the fuller reasoning on why a single-glyph watermark was
 * chosen over trying to generalize arbitrary background artwork.
 *
 * Colors are referenced by CSS custom-property NAME (e.g. "--accent-1"),
 * not by hex value — resolved at render time via readThemeColors()
 * against the site's own globals.css. This means changing a color in the
 * stylesheet changes the OG image too, with nothing to keep in sync by
 * hand.
 */
export interface OgTemplateConfig {
  /** Site name shown next to the badge, e.g. "Velocity-B", "mediasurface". */
  siteName: string;
  /** Single character shown in the small circular badge (e.g. "B", "M"). */
  badgeInitial: string;
  /** Single character rendered large and low-opacity as a background
   *  watermark (e.g. ">" for Velocity B, "M" for Martech Insiders). */
  watermarkGlyph: string;
  /** CSS custom-property name for the card's background color. */
  backgroundVar: string;
  /** CSS custom-property name for the primary text color. */
  foregroundVar: string;
  /** CSS custom-property names for the accent cycle, in order. Cycled by
   *  a tag's position in getAllTags() — same tag always gets the same
   *  accent, matching Velocity B's accentForTagIndex() convention. */
  accentVars: string[];
  /** Optional: real font files to embed via next/og's ImageResponse
   *  (Satori requires embedded fonts for anything beyond its built-in
   *  fallback). Omit to use ImageResponse's default font — reasonable
   *  for an unbranded reference demo; a real branded site (e.g. Martech
   *  Insiders' Space Grotesk/Lato) would supply these. */
  fontUrls?: { bold: string; medium: string };
  fontFamily?: string;
}
