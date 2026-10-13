"use client";

import { useEffect, useRef, useState } from "react";
import { buildContentModel, type ContentModel } from "@/lib/seo/content/model";
import type { AuditResult } from "@/lib/seo/types";

/**
 * The content model for a finished (or stopped) scan, built in a Web Worker.
 * Not rebuilt while the scan runs — the topic map needs the whole site to
 * mean anything. Falls back to the main thread if workers aren't available.
 */
export function useContentModel(
  audit: AuditResult | null,
  phrases: string[],
  ready: boolean
): { model: ContentModel | null; working: boolean; error: string | null } {
  const [state, setState] = useState<{ key: string; model: ContentModel | null; error: string | null } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  // A finished audit doesn't change, so its identity is enough.
  const key = audit && ready ? `${audit.startedAt}|${audit.finishedAt}|${audit.pages.length}|${phrases.join("\n")}` : "";

  useEffect(() => {
    if (!key || !audit) return;
    const mine = ++seq.current;
    let cancelled = false;
    const done = (model: ContentModel | null, error: string | null) => {
      if (!cancelled && mine === seq.current) setState({ key, model, error });
    };
    try {
      if (!worker.current) {
        worker.current = new Worker(new URL("./content-worker.ts", import.meta.url), { type: "module" });
      }
      const w = worker.current;
      const onMessage = (e: MessageEvent<{ seq: number; model: ContentModel | null; error: string | null }>) => {
        if (e.data.seq === mine) done(e.data.model, e.data.error);
      };
      w.addEventListener("message", onMessage);
      w.postMessage({ seq: mine, audit, phrases });
      return () => {
        cancelled = true;
        w.removeEventListener("message", onMessage);
      };
    } catch {
      // No worker (old browser, blocked): build it here, after this paint.
      const t = setTimeout(() => {
        try {
          done(buildContentModel(audit, phrases), null);
        } catch (err) {
          done(null, err instanceof Error ? err.message : String(err));
        }
      }, 50);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures audit + phrases
  }, [key]);

  useEffect(() => () => worker.current?.terminate(), []);

  const current = state && state.key === key ? state : null;
  return { model: current?.model ?? null, working: !!key && !current, error: current?.error ?? null };
}
