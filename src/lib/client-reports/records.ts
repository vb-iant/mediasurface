/**
 * Client + published-report records, and passcode checking. Shared with the
 * client viewer (`vb-iant/velocity-b-tools`), which has a verbatim copy —
 * keep the two in step. Admin-only operations (create client, publish,
 * reset passcode) live in ./admin.ts, which the viewer doesn't have.
 *
 * One link + one passcode per client (Ian, 2026-10-14). The link token is
 * also the client's id: 128 random bits, so the link alone is unguessable
 * and the passcode is a second lock. v1 shows the client their latest
 * report; every published report is kept, so v2 can list past ones at the
 * same link without moving anything.
 */

import "server-only";
import { gunzipSync } from "node:zlib";
import { storage } from "./storage";

export const PBKDF2_ITERATIONS = 210_000;

export interface PasscodeHash {
  alg: "PBKDF2-SHA256";
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
}

export interface ClientRecord {
  version: 1;
  /** Link token and id: /c/<token>. */
  token: string;
  /** Shown to the client in the viewer header and to Ian in the admin. */
  name: string;
  passcode: PasscodeHash;
  createdAt: string;
  updatedAt: string;
  /** Set when access is withdrawn: the link stops working, reports are kept. */
  revokedAt: string | null;
}

export interface ReportRef {
  pathname: string;
  token: string;
  publishedAt: string;
  host: string;
  size: number;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function isToken(s: string): boolean {
  return TOKEN_RE.test(s);
}

export const clientPath = (token: string) => `clients/${token}.json`;
export const reportPrefix = (token: string) => `reports/${token}/`;

// ------------------------------------------------------------ base64

export function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

// ------------------------------------------------------------ passcodes

/** Lower-case, trimmed, spaces and dashes collapsed — forgiving to type. */
export function normalisePasscode(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_-]+/g, "-");
}

async function derive(passcode: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalisePasscode(passcode)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPasscode(passcode: string): Promise<PasscodeHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(passcode, salt, PBKDF2_ITERATIONS);
  return { alg: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: toB64(salt), hash: toB64(hash) };
}

export async function verifyPasscode(passcode: string, stored: PasscodeHash): Promise<boolean> {
  if (stored.alg !== "PBKDF2-SHA256") return false;
  const got = await derive(passcode, fromB64(stored.salt), stored.iterations);
  const want = fromB64(stored.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ------------------------------------------------------------ reads

export async function getClient(token: string): Promise<ClientRecord | null> {
  if (!isToken(token)) return null;
  const buf = await storage.get(clientPath(token));
  if (!buf) return null;
  try {
    const rec = JSON.parse(buf.toString("utf8")) as ClientRecord;
    return rec.token === token ? rec : null;
  } catch {
    return null;
  }
}

/** reports/<token>/<YYYYMMDDTHHMMSSZ>-<host>-<rand>.json.gz */
const REPORT_NAME_RE = /^(\d{8}T\d{6}Z)-([a-z0-9.-]+)-([A-Za-z0-9]{8})\.json\.gz$/;

function stampToIso(stamp: string): string {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

export function parseReportPath(pathname: string, size = 0): ReportRef | null {
  const parts = pathname.split("/");
  if (parts.length !== 3 || parts[0] !== "reports" || !isToken(parts[1])) return null;
  const m = REPORT_NAME_RE.exec(parts[2]);
  if (!m) return null;
  return { pathname, token: parts[1], publishedAt: stampToIso(m[1]), host: m[2], size };
}

/** Newest first. */
export async function listReports(token: string): Promise<ReportRef[]> {
  if (!isToken(token)) return [];
  const objs = await storage.list(reportPrefix(token));
  return objs
    .map((o) => parseReportPath(o.pathname, o.size))
    .filter((r): r is ReportRef => r !== null)
    .sort((a, b) => b.pathname.localeCompare(a.pathname));
}

/** The stored report JSON, parsed. Typed by the caller (the shapes differ per repo). */
export async function readReport<T = unknown>(ref: ReportRef): Promise<T | null> {
  const buf = await storage.get(ref.pathname);
  if (!buf) return null;
  try {
    return JSON.parse(gunzipSync(buf).toString("utf8")) as T;
  } catch {
    return null;
  }
}
