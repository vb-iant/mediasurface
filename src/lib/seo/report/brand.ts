/**
 * Branding for the downloadable report (PDF + Excel workbook).
 *
 * Client-facing outputs carry the brand of whoever ran the audit — Velocity
 * B by default — not Mediasurface, which is only the internal tool name
 * (Ian, 2026-10-12; see CLAUDE.md "Report outputs"). A config object rather
 * than hard-coded values, same idea as OgTemplateConfig, so white-labelling
 * later is a new config, not a rewrite. Not built: choosing a brand in the
 * UI — there's one brand until there's a reason for two.
 *
 * Velocity B values are taken from the velocity-b repo (read-only):
 * tailwind.config.ts colours, Space Grotesk (display) + Work Sans (body)
 * from app/layout.tsx, and the logo from components/Logo.tsx (navy circle,
 * rotated "V" + "B", wordmark). Fonts are bundled in public/fonts/report/
 * (OFL, from @fontsource) so the PDF doesn't depend on a font CDN.
 */

export interface ReportFontFace {
  src: string;
  fontWeight: number;
}

export interface ReportBrand {
  /** Shown on the cover, page footers and the workbook's About tab. */
  name: string;
  website: string;
  websiteLabel: string;
  colors: {
    /** Cover background, headings. */
    primary: string;
    /** Accent rules and highlights. */
    accent: string;
    secondAccent: string;
    text: string;
    muted: string;
    hairline: string;
    /** Light panel background. */
    panel: string;
  };
  fonts: {
    display: { family: string; faces: ReportFontFace[] };
    body: { family: string; faces: ReportFontFace[] };
  };
  /** The logo is drawn, not an image file: letters in a circle + wordmark. */
  logo: { mark: "velocity-b" };
}

export const VELOCITY_B_BRAND: ReportBrand = {
  name: "Velocity B",
  website: "https://www.velocity-b.com",
  websiteLabel: "velocity-b.com",
  colors: {
    primary: "#0A1543",
    accent: "#5CA6FF",
    secondAccent: "#FF8A3D",
    text: "#1B2235",
    muted: "#5B6275",
    hairline: "#E7E8EE",
    panel: "#F5F6FA",
  },
  fonts: {
    display: {
      family: "Space Grotesk",
      faces: [
        { src: "/fonts/report/space-grotesk-latin-500-normal.woff", fontWeight: 500 },
        { src: "/fonts/report/space-grotesk-latin-700-normal.woff", fontWeight: 700 },
      ],
    },
    body: {
      family: "Work Sans",
      faces: [
        { src: "/fonts/report/work-sans-latin-400-normal.woff", fontWeight: 400 },
        { src: "/fonts/report/work-sans-latin-600-normal.woff", fontWeight: 600 },
      ],
    },
  },
  logo: { mark: "velocity-b" },
};
