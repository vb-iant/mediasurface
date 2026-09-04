/**
 * mediasurface's own OG template config. Deliberately neutral — this repo
 * has no real brand identity (it's the admin app, not a published site).
 * Exists to prove the config-driven renderOgImage mechanism works
 * end-to-end, not to look like a finished product. A real site adopting
 * this system (Velocity B, Martech Insiders) supplies its own config with
 * its own colors/glyph/font.
 */

import type { OgTemplateConfig } from "./types";

export const mediasurfaceOgConfig: OgTemplateConfig = {
  siteName: "mediasurface",
  badgeInitial: "M",
  watermarkGlyph: "M",
  backgroundVar: "--background",
  foregroundVar: "--foreground",
  accentVars: ["--accent-1", "--accent-2", "--accent-3"],
  // No fontUrls: uses ImageResponse's built-in default font. A branded
  // site would supply real font URLs here (e.g. Martech Insiders' Space
  // Grotesk/Lato).
};
