/**
 * Shared social-share (OG) image renderer, config-driven per site (see
 * types.ts). Every route's opengraph-image.tsx calls renderOgImage(config,
 * {...}) with page-specific copy — this file is the only place that
 * touches ImageResponse, mirroring Velocity B's lib/og.tsx structure.
 *
 * "Shared" here means the same pattern as everything else ported from
 * this reference implementation: this file gets copied into a site's own
 * repo along with its own OgTemplateConfig when that site adopts it —
 * there's no runtime package shared across the separate Velocity B /
 * Martech Insiders / mediasurface deployments.
 */

import { ImageResponse } from "next/og";
import { readThemeColors } from "./theme-colors";
import type { OgTemplateConfig } from "./types";

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";

const fontCache = new Map<string, Promise<ArrayBuffer>>();

async function getFonts(config: OgTemplateConfig) {
  if (!config.fontUrls) return undefined;
  const { bold: boldUrl, medium: mediumUrl } = config.fontUrls;

  if (!fontCache.has(boldUrl)) {
    // force-cache: an uncached fetch inside an image route makes the
    // whole route dynamic, defeating generateStaticParams on per-slug
    // variants — same reasoning Velocity B's lib/og.tsx documents.
    fontCache.set(
      boldUrl,
      fetch(boldUrl, { cache: "force-cache" }).then((res) => res.arrayBuffer())
    );
  }
  if (!fontCache.has(mediumUrl)) {
    fontCache.set(
      mediumUrl,
      fetch(mediumUrl, { cache: "force-cache" }).then((res) => res.arrayBuffer())
    );
  }

  const [bold, medium] = await Promise.all([
    fontCache.get(boldUrl)!,
    fontCache.get(mediumUrl)!,
  ]);

  const family = config.fontFamily ?? "Site Font";
  return [
    { name: `${family} Bold`, data: bold, weight: 700 as const, style: "normal" as const },
    { name: `${family} Medium`, data: medium, weight: 500 as const, style: "normal" as const },
  ];
}

/** Resolves a tag's position in the site's accent cycle. Same tag always
 * gets the same accent, matching Velocity B's accentForTagIndex()
 * convention — pass the tag's index in getAllTags() order. */
export function accentVarForIndex(config: OgTemplateConfig, index: number): string {
  return config.accentVars[index % config.accentVars.length];
}

export async function renderOgImage(
  config: OgTemplateConfig,
  { eyebrow, title, accentIndex = 0 }: { eyebrow: string; title: string; accentIndex?: number }
) {
  const colors = readThemeColors();
  const background = colors[config.backgroundVar] ?? "#ffffff";
  const foreground = colors[config.foregroundVar] ?? "#111111";
  const accentVar = accentVarForIndex(config, accentIndex);
  const accent = colors[accentVar] ?? foreground;

  const fonts = await getFonts(config);
  const family = config.fontFamily ?? "Site Font";
  const boldFont = fonts ? `${family} Bold` : undefined;
  const mediumFont = fonts ? `${family} Medium` : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          position: "relative",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background,
          padding: "76px",
          overflow: "hidden",
        }}
      >
        {/* Ghosted single-glyph watermark — the shareable substitute for
            Velocity B's bespoke chevron SVG. One character, low opacity,
            oversized, positioned off-canvas top-right. */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: -140,
            right: -60,
            fontSize: 560,
            lineHeight: 1,
            fontWeight: 700,
            ...(boldFont ? { fontFamily: boldFont } : {}),
            color: accent,
            opacity: 0.1,
          }}
        >
          {config.watermarkGlyph}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            ...(mediumFont ? { fontFamily: mediumFont } : {}),
            color: accent,
          }}
        >
          {eyebrow}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 58,
            lineHeight: 1.15,
            fontWeight: 700,
            ...(boldFont ? { fontFamily: boldFont } : {}),
            color: foreground,
            maxWidth: 900,
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: accent,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              fontWeight: 700,
              ...(boldFont ? { fontFamily: boldFont } : {}),
              color: background,
            }}
          >
            {config.badgeInitial}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 700,
              ...(boldFont ? { fontFamily: boldFont } : {}),
              color: foreground,
            }}
          >
            {config.siteName}
          </div>
        </div>
      </div>
    ),
    {
      ...ogSize,
      ...(fonts ? { fonts } : {}),
    }
  );
}
