/**
 * Admin-side client report operations: create a client, reset its passcode,
 * withdraw access, publish an audit, remove a published report. Called only
 * from the /api/client-reports/* routes, which check the admin session.
 * The viewer repo doesn't have this file — it only reads.
 */

import "server-only";
import { gunzipSync } from "node:zlib";
import { storage } from "./storage";
import {
  clientPath,
  getClient,
  hashPasscode,
  isToken,
  listReports,
  parseReportPath,
  reportPrefix,
  toB64,
  type ClientRecord,
  type ReportRef,
} from "./records";
import { PUBLISHED_REPORT_VERSION, type PublishedReport } from "@/lib/seo/report/publish";

/** Where client links point. */
export function viewerBaseUrl(): string {
  return (process.env.CLIENT_VIEWER_URL || "https://tools.velocity-b.com").replace(/\/+$/, "");
}

export function clientLink(token: string): string {
  return `${viewerBaseUrl()}/c/${token}`;
}

function randomToken(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Unbiased random int in [0, n). */
function randInt(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

// Short, common, unambiguous words — easy to read out on a call.
const WORDS = (
  "amber anchor apple arrow aspen atlas autumn badge bamboo banner basil beacon berry birch bison blaze bloom bolt " +
  "branch breeze brick bridge brook bubble cabin cactus candle canyon carbon cedar chalk cherry cider clover cobalt comet " +
  "copper coral cotton crane crystal daisy delta denim desert dolphin dragon drift eagle echo ember falcon fern fiddle " +
  "flint forest fossil fox galaxy garnet ginger glacier granite gravel harbour hazel heron hollow honey horizon iris island " +
  "ivory jasper juniper kayak kettle kiwi lagoon lantern lava lemon lilac linen lotus lunar maple marble meadow mint " +
  "mosaic moss nectar nickel nova oak oasis olive onyx orbit orchid otter owl paddle panda pebble pepper pine planet " +
  "plum polar poppy prairie prism quartz quill rabbit raven reef ripple river robin rocket saffron sage salmon sapphire " +
  "scarlet shadow shell sierra silver sparrow spruce stone summit sunset swift tango thistle thunder tiger timber topaz " +
  "tulip tundra valley velvet violet walnut willow winter yellow zephyr"
).split(/\s+/);

export function generatePasscode(): string {
  const words = new Set<string>();
  while (words.size < 3) words.add(WORDS[randInt(WORDS.length)]);
  return `${[...words].join("-")}-${100 + randInt(900)}`;
}

export interface ClientSummary {
  token: string;
  name: string;
  link: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  reports: ReportRef[];
}

function summary(rec: ClientRecord, reports: ReportRef[]): ClientSummary {
  return {
    token: rec.token,
    name: rec.name,
    link: clientLink(rec.token),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    revokedAt: rec.revokedAt,
    reports,
  };
}

async function save(rec: ClientRecord): Promise<void> {
  await storage.put(clientPath(rec.token), Buffer.from(JSON.stringify(rec, null, 2)), "application/json");
}

export async function listClients(): Promise<ClientSummary[]> {
  const objs = await storage.list("clients/");
  const out: ClientSummary[] = [];
  for (const o of objs) {
    const m = /^clients\/([A-Za-z0-9_-]{22})\.json$/.exec(o.pathname);
    if (!m) continue;
    const rec = await getClient(m[1]);
    if (rec) out.push(summary(rec, await listReports(rec.token)));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

export async function createClient(name: string): Promise<{ client: ClientSummary; passcode: string }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!clean) throw new Error("Client name is required.");
  const passcode = generatePasscode();
  const now = new Date().toISOString();
  const rec: ClientRecord = {
    version: 1,
    token: randomToken(),
    name: clean,
    passcode: await hashPasscode(passcode),
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
  await save(rec);
  return { client: summary(rec, []), passcode };
}

export async function resetPasscode(token: string): Promise<{ client: ClientSummary; passcode: string } | null> {
  const rec = await getClient(token);
  if (!rec) return null;
  const passcode = generatePasscode();
  const next: ClientRecord = { ...rec, passcode: await hashPasscode(passcode), updatedAt: new Date().toISOString() };
  await save(next);
  return { client: summary(next, await listReports(token)), passcode };
}

export async function setRevoked(token: string, revoked: boolean): Promise<ClientSummary | null> {
  const rec = await getClient(token);
  if (!rec) return null;
  const now = new Date().toISOString();
  const next: ClientRecord = { ...rec, revokedAt: revoked ? now : null, updatedAt: now };
  await save(next);
  return summary(next, await listReports(token));
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[randInt(chars.length)];
  return s;
}

/** Max accepted upload (gzipped). Vercel's request limit is 4.5 MB. */
export const MAX_UPLOAD_BYTES = 4_400_000;
/** Max size once unzipped — a 5,000-page audit is a few MB. */
const MAX_UNZIPPED_BYTES = 60_000_000;

/** Validates the gzipped snapshot and stores it as the client's newest report. */
export async function publishReport(token: string, gz: Buffer): Promise<ReportRef> {
  if (!isToken(token)) throw new Error("Unknown client.");
  const rec = await getClient(token);
  if (!rec) throw new Error("Unknown client.");
  if (gz.length > MAX_UPLOAD_BYTES) throw new Error("Report is too large to publish.");
  let report: PublishedReport;
  try {
    const raw = gunzipSync(gz, { maxOutputLength: MAX_UNZIPPED_BYTES });
    report = JSON.parse(raw.toString("utf8")) as PublishedReport;
  } catch {
    throw new Error("The report data couldn't be read.");
  }
  if (report?.version !== PUBLISHED_REPORT_VERSION || !report.site?.host || !Array.isArray(report.sections) || !Array.isArray(report.pages)) {
    throw new Error("The report data isn't in the expected format.");
  }
  const host = report.site.host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "-").slice(0, 60) || "site";
  const pathname = `${reportPrefix(token)}${stamp(new Date())}-${host}-${randomSuffix()}.json.gz`;
  await storage.put(pathname, gz, "application/gzip");
  const ref = parseReportPath(pathname, gz.length);
  if (!ref) throw new Error("Couldn't name the report.");
  return ref;
}

export async function deleteReport(token: string, pathname: string): Promise<boolean> {
  const ref = parseReportPath(pathname);
  if (!ref || ref.token !== token) return false;
  await storage.del([pathname]);
  return true;
}
