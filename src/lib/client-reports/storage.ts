/**
 * Storage for published client reports — a private Vercel Blob store shared
 * with the client viewer (`vb-iant/velocity-b-tools`). mediasurface writes,
 * the viewer reads. Layout (see CLAUDE.md "Client report publishing"):
 *
 *   clients/<token>.json                         one per client
 *   reports/<token>/<stamp>-<host>-<rand>.json.gz  one per published audit
 *
 * Not GitHub: audit data never goes in a repo (every write would deploy).
 *
 * Driver: Vercel Blob when BLOB_READ_WRITE_TOKEN is set (connecting the
 * store to the Vercel project sets it). Without it, outside production, a
 * local folder (CLIENT_REPORTS_DIR, default ./.client-reports) so both apps
 * can be run and tested together on one machine. This file is copied
 * verbatim into the viewer repo — keep the two in step.
 */

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface StoredObject {
  pathname: string;
  size: number;
  uploadedAt: Date;
}

interface Driver {
  put(pathname: string, body: Buffer, contentType: string): Promise<void>;
  get(pathname: string): Promise<Buffer | null>;
  list(prefix: string): Promise<StoredObject[]>;
  del(pathnames: string[]): Promise<void>;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Client report storage isn't set up: connect the Blob store to this Vercel project (sets BLOB_READ_WRITE_TOKEN).");
  }
}

const blobDriver: Driver = {
  async put(pathname, body, contentType) {
    const { put } = await import("@vercel/blob");
    await put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true });
  },
  async get(pathname) {
    const { get } = await import("@vercel/blob");
    const res = await get(pathname, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  },
  async list(prefix) {
    const { list } = await import("@vercel/blob");
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) out.push({ pathname: b.pathname, size: b.size, uploadedAt: new Date(b.uploadedAt) });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async del(pathnames) {
    if (!pathnames.length) return;
    const { del } = await import("@vercel/blob");
    await del(pathnames);
  },
};

function localRoot(): string {
  // Dev-only local store; keep the bundler from tracing the project folder.
  return path.resolve(/*turbopackIgnore: true*/ process.env.CLIENT_REPORTS_DIR || ".client-reports");
}

function localPath(pathname: string): string {
  const root = localRoot();
  const full = path.resolve(/*turbopackIgnore: true*/ root, pathname);
  if (!full.startsWith(root + path.sep)) throw new Error("Bad storage path");
  return full;
}

const fsDriver: Driver = {
  async put(pathname, body) {
    const full = localPath(pathname);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  },
  async get(pathname) {
    try {
      return await fs.readFile(localPath(pathname));
    } catch {
      return null;
    }
  },
  async list(prefix) {
    const root = localRoot();
    const out: StoredObject[] = [];
    async function walk(dir: string) {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          const pathname = path.relative(root, full).split(path.sep).join("/");
          if (!pathname.startsWith(prefix)) continue;
          const st = await fs.stat(full);
          out.push({ pathname, size: st.size, uploadedAt: st.mtime });
        }
      }
    }
    await walk(root);
    return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
  },
  async del(pathnames) {
    for (const p of pathnames) await fs.rm(localPath(p), { force: true });
  },
};

function driver(): Driver {
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobDriver;
  if (process.env.NODE_ENV !== "production" || process.env.CLIENT_REPORTS_DIR) return fsDriver;
  throw new StorageNotConfiguredError();
}

export const storage: Driver = {
  put: (p, b, t) => driver().put(p, b, t),
  get: (p) => driver().get(p),
  list: (p) => driver().list(p),
  del: (p) => driver().del(p),
};
