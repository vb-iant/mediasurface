/**
 * Reads CSS custom properties (`--name: value;`) out of a site's own
 * globals.css, so OG-image generation pulls colors from the same single
 * source of truth as the rest of the site's styling, rather than
 * duplicating hex values in TSX. This is a deliberately simple
 * regex-based reader, not a real CSS parser — it's reading a small,
 * known, hand-written file for named custom properties, not arbitrary
 * CSS. Each site that adopts this OG system reads its OWN globals.css
 * (same "shared pattern, per-site copy" approach as everything else
 * ported from this reference implementation — see CLAUDE.md).
 *
 * First declaration of a given `--name` wins. This is intentional, not a
 * limitation to fix: it means a later `@media (prefers-color-scheme:
 * dark)` block's redeclaration of the same variable is correctly
 * ignored — OG images are static, pre-rendered PNGs with no concept of
 * the viewer's color-scheme preference, so the base (light) declaration
 * is always the right one to use.
 */

import fs from "fs";
import path from "path";

const GLOBALS_CSS_PATH = path.join(process.cwd(), "src/app/globals.css");

let cache: Record<string, string> | null = null;

export function readThemeColors(): Record<string, string> {
  if (cache) return cache;

  const result: Record<string, string> = {};
  if (fs.existsSync(GLOBALS_CSS_PATH)) {
    const css = fs.readFileSync(GLOBALS_CSS_PATH, "utf-8");
    const pattern = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(css)) !== null) {
      const [, name, value] = match;
      const key = `--${name}`;
      if (!(key in result)) {
        result[key] = value.trim();
      }
    }
  }

  cache = result;
  return result;
}
