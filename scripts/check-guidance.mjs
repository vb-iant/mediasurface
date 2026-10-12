// Checks that every finding id raised in src/lib/seo has fix guidance in
// src/lib/seo/guidance.ts, and that guidance has no entries for ids that no
// longer exist. Run after adding or renaming a check:
//
//   node scripts/check-guidance.mjs
//
// Finding ids are found by pattern (id: "x", add("x", imageFinding("x", and
// the "field-*" ids built in speed.ts) — crude, but the checks are written
// in a consistent style, and a miss shows up as a failure here rather than
// silently.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const seo = join(root, "src/lib/seo");
const files = [
  join(seo, "findings.ts"),
  ...readdirSync(join(seo, "checks"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(seo, "checks", f)),
];

const raised = new Set();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:\bid:\s*|\badd\(\s*|\bimageFinding\(\s*)"([a-z0-9-]+)"/g)) raised.add(m[1]);
  for (const m of src.matchAll(/"(field-[a-z-]+)"/g)) raised.add(m[1]);
}

const guidanceSrc = readFileSync(join(seo, "guidance.ts"), "utf8");
const body = guidanceSrc.slice(guidanceSrc.indexOf("export const GUIDANCE"));
const documented = new Set(
  [...body.matchAll(/^\s{2}(?:"([a-z0-9-]+)"|([a-z0-9]+)):\s*(?:issue|note)\(/gm)].map((m) => m[1] ?? m[2])
);

const missing = [...raised].filter((id) => !documented.has(id)).sort();
const stale = [...documented].filter((id) => !raised.has(id)).sort();

console.log(`${raised.size} finding ids raised, ${documented.size} documented.`);
if (missing.length) console.error(`Missing guidance: ${missing.join(", ")}`);
if (stale.length) console.error(`Guidance for ids no check raises: ${stale.join(", ")}`);
process.exit(missing.length || stale.length ? 1 : 0);
