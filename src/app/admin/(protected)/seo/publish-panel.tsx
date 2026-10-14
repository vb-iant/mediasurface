"use client";

/**
 * "Share with client" panel on the audit overview (Ian, 2026-10-14):
 * publishes this audit as an interactive report at tools.velocity-b.com,
 * behind one link + passcode per client. The client always sees their
 * newest report; every published report is kept for the later "past
 * reports" view. See CLAUDE.md "Client report publishing".
 *
 * The snapshot is built here in the browser from the audit already in the
 * tab, gzipped, and sent to /api/client-reports/<token>/publish.
 */

import { useCallback, useEffect, useState } from "react";
import { isActive, isContentScan, type AuditRecord } from "./audit-store";
import { card, muted } from "./report";

interface ReportRef {
  pathname: string;
  publishedAt: string;
  host: string;
  size: number;
}

interface ClientSummary {
  token: string;
  name: string;
  link: string;
  revokedAt: string | null;
  reports: ReportRef[];
}

const btn =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
const linkBtn =
  "text-xs font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50";
const input =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={linkBtn}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // Clipboard blocked — the text is on screen to copy by hand.
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function PublishPanel({ record }: { record: AuditRecord }) {
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown once, straight after a client is created or its passcode reset. */
  const [freshPasscode, setFreshPasscode] = useState<{ token: string; passcode: string } | null>(null);
  const [published, setPublished] = useState<{ token: string; link: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { clients } = await api<{ clients: ClientSummary[] }>("/api/client-reports");
      setClients(clients);
      setSelected((s) => s || clients.find((c) => !c.revokedAt)?.token || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setClients([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const audit = record.audit;
  if (!audit || isActive(record) || isContentScan(record)) return null;

  const client = clients?.find((c) => c.token === selected) ?? null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run("create", async () => {
      const out = await api<{ client: ClientSummary; passcode: string }>("/api/client-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      setNewName("");
      setFreshPasscode({ token: out.client.token, passcode: out.passcode });
      await load();
      setSelected(out.client.token);
    });

  const publish = () =>
    run("publish", async () => {
      if (!client) return;
      const [{ buildPublishedReport, packPublishedReport }, { computeFindings }] = await Promise.all([
        import("@/lib/seo/report/publish"),
        import("@/lib/seo/findings"),
      ]);
      const report = buildPublishedReport(audit, record.phase, { checkExternal: record.options.checkExternal }, computeFindings(audit));
      const body = await packPublishedReport(report);
      const out = await api<{ link: string }>(`/api/client-reports/${client.token}/publish`, {
        method: "POST",
        headers: { "content-type": "application/gzip" },
        body: body as BodyInit,
      });
      setPublished({ token: client.token, link: out.link });
      await load();
    });

  const patch = (action: "reset" | "revoke" | "restore") =>
    run(action, async () => {
      if (!client) return;
      if (action === "reset" && !confirm(`Make a new passcode for ${client.name}? Their current passcode will stop working.`)) return;
      if (action === "revoke" && !confirm(`Withdraw ${client.name}'s access? Their link will stop working (reports are kept).`)) return;
      const out = await api<{ client: ClientSummary; passcode?: string }>(`/api/client-reports/${client.token}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (out.passcode) setFreshPasscode({ token: client.token, passcode: out.passcode });
      await load();
    });

  const remove = (ref: ReportRef) =>
    run(`del:${ref.pathname}`, async () => {
      if (!client) return;
      if (!confirm(`Remove the ${ref.host} report from ${when(ref.publishedAt)}? The client won't see it any more.`)) return;
      await api(`/api/client-reports/${client.token}/reports?path=${encodeURIComponent(ref.pathname)}`, { method: "DELETE" });
      await load();
    });

  return (
    <section className={`${card} mt-4 px-4 py-4`} aria-label="Share with client">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Share with client</h2>
      <p className={`mt-0.5 text-xs ${muted}`}>
        Publishes this audit as an interactive report at tools.velocity-b.com. Each client has one link and one passcode, and always
        sees the newest report you&apos;ve published for them.
      </p>

      {clients === null ? (
        <p className={`mt-3 text-xs ${muted}`}>Loading clients…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {clients.length > 0 && (
              <select
                aria-label="Client"
                className={input}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setPublished(null);
                }}
              >
                {clients.map((c) => (
                  <option key={c.token} value={c.token}>
                    {c.name}
                    {c.revokedAt ? " (access withdrawn)" : ""}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className={btn} onClick={publish} disabled={!client || !!client.revokedAt || busy !== null}>
              {busy === "publish" ? "Publishing…" : client ? `Publish for ${client.name}` : "Publish"}
            </button>
          </div>

          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create();
            }}
          >
            <input
              className={`${input} w-56`}
              placeholder="New client name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New client name"
            />
            <button type="submit" className={linkBtn} disabled={!newName.trim() || busy !== null}>
              {busy === "create" ? "Adding…" : "Add client"}
            </button>
          </form>

          {freshPasscode && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              Passcode for {clients.find((c) => c.token === freshPasscode.token)?.name ?? "this client"}:{" "}
              <code className="font-mono font-semibold">{freshPasscode.passcode}</code>{" "}
              <Copy text={freshPasscode.passcode} label="Copy" />
              <p className="mt-1 text-xs">
                Note it now — it isn&apos;t stored and can&apos;t be shown again. If it&apos;s lost, make a new one below. Send it separately
                from the link.
              </p>
            </div>
          )}

          {published && published.token === selected && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              Published.{" "}
              <a href={published.link} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Open the client link
              </a>{" "}
              <Copy text={published.link} label="Copy link" />
            </p>
          )}

          {client && (
            <div className="border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={muted}>Link:</span>
                <code className="break-all font-mono text-zinc-700 dark:text-zinc-300">{client.link}</code>
                <Copy text={client.link} label="Copy" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" className={linkBtn} onClick={() => patch("reset")} disabled={busy !== null}>
                  New passcode
                </button>
                {client.revokedAt ? (
                  <button type="button" className={linkBtn} onClick={() => patch("restore")} disabled={busy !== null}>
                    Restore access
                  </button>
                ) : (
                  <button type="button" className={linkBtn} onClick={() => patch("revoke")} disabled={busy !== null}>
                    Withdraw access
                  </button>
                )}
              </div>
              <h3 className="mt-3 font-medium text-zinc-900 dark:text-zinc-50">
                Published for {client.name} ({client.reports.length})
              </h3>
              {client.reports.length === 0 ? (
                <p className={`mt-1 ${muted}`}>Nothing yet.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {client.reports.map((r, i) => (
                    <li key={r.pathname} className="flex flex-wrap items-center gap-x-3">
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {r.host} · {when(r.publishedAt)}
                        {i === 0 && <span className={muted}> · what the client sees</span>}
                      </span>
                      <button type="button" className={linkBtn} onClick={() => remove(r)} disabled={busy !== null}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
