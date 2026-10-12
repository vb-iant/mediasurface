// Public guide to every item the site audit can report — "why it matters"
// and "how to fix" for each finding id. Agreed with Ian 2026-10-12: public
// (no client data here, only the shared copy in src/lib/seo/guidance.ts),
// lives on mediasurface.app for now, one anchor per finding id so the PDF
// summary and Excel workbook can link straight to an entry
// (`/seo-guide#canonical-off-site`). Anchors are therefore part of reports
// already sent to clients — keep them stable.
//
// Outside /admin, so src/proxy.ts never gates it. Static: built at deploy.

import type { Metadata } from "next";
import type { Finding } from "@/lib/seo/findings";
import { GUIDANCE, codeSegments, type Guidance, type IssueGuidance, type NoteGuidance } from "@/lib/seo/guidance";
import { STAGES } from "@/app/admin/(protected)/seo/stages";

export const metadata: Metadata = {
  title: "Site audit guide — what each issue means and how to fix it",
  description:
    "Plain-English explanations for every item in our technical SEO site audit: why each issue matters and what to change to fix it.",
};

type Entry<G extends Guidance> = { id: string; g: G };

/** Places an entry under the same stage the on-screen report uses. */
function stageFor(id: string, g: Guidance) {
  const probe = { id, category: g.category } as Finding;
  return STAGES.find((s) => s.owns(probe));
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {codeSegments(text).map((seg, i) =>
        seg.code ? (
          <code key={i} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            {seg.text}
          </code>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

const entryCard =
  "scroll-mt-6 rounded-lg border border-zinc-200 bg-white p-5 target:border-zinc-900 target:ring-2 target:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:target:border-zinc-200 dark:target:ring-zinc-200/10";
const label = "text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

function IssueEntry({ id, g }: Entry<IssueGuidance>) {
  return (
    <article id={id} className={entryCard}>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        <a href={`#${id}`} className="hover:underline">
          <Rich text={g.title} />
        </a>
      </h3>
      <dl className="mt-3 grid gap-3 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 sm:grid-cols-2 sm:gap-6">
        <div className="min-w-0">
          <dt className={label}>Why it matters</dt>
          <dd className="mt-1">
            <Rich text={g.why} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={label}>How to fix</dt>
          <dd className="mt-1">
            <Rich text={g.how} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

function NoteEntry({ id, g }: Entry<NoteGuidance>) {
  return (
    <article id={id} className={entryCard}>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        <a href={`#${id}`} className="hover:underline">
          {g.title}
        </a>
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <Rich text={g.line} />
      </p>
    </article>
  );
}

export default function SeoGuidePage() {
  const all = Object.entries(GUIDANCE);
  const notes = all.filter((e): e is [string, NoteGuidance] => e[1].kind === "note");
  const groups = STAGES.map((stage) => ({
    stage,
    entries: all.filter(
      (e): e is [string, IssueGuidance] => e[1].kind === "issue" && stageFor(e[0], e[1])?.id === stage.id
    ),
  })).filter((grp) => grp.entries.length > 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <header>
        <p className={label}>Site audit</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          What each issue means, and how to fix it
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          Every item our technical site audit can report, in plain English. Each one explains why it matters and what to
          change. Links in your audit report point straight to the relevant entry here.
        </p>
      </header>

      <nav aria-label="Sections" className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <p className={label}>Sections</p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {groups.map(({ stage, entries }) => (
            <li key={stage.id}>
              <a href={`#stage-${stage.id}`} className="text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-800 dark:text-zinc-200 dark:decoration-zinc-600">
                {stage.title}
              </a>{" "}
              <span className="text-zinc-500 dark:text-zinc-400">({entries.length})</span>
            </li>
          ))}
          <li>
            <a href="#about-the-audit" className="text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-800 dark:text-zinc-200 dark:decoration-zinc-600">
              About the audit
            </a>
          </li>
        </ul>
      </nav>

      {groups.map(({ stage, entries }) => (
        <section key={stage.id} id={`stage-${stage.id}`} className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{stage.title}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{stage.blurb}</p>
          <div className="mt-4 space-y-3">
            {entries.map(([id, g]) => (
              <IssueEntry key={id} id={id} g={g} />
            ))}
          </div>
        </section>
      ))}

      <section id="about-the-audit" className="mt-12 scroll-mt-6">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">About the audit</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          These describe how much of the site an audit covered, not a problem with the site itself.
        </p>
        <div className="mt-4 space-y-3">
          {notes.map(([id, g]) => (
            <NoteEntry key={id} id={id} g={g} />
          ))}
        </div>
        <p className="mt-6 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          The audit reads each page&apos;s HTML as served, without running JavaScript, so links that only appear after
          scripts run aren&apos;t found. Page speed is tested on a sample of pages using Google PageSpeed Insights, and
          scores vary between runs.
        </p>
      </section>
    </main>
  );
}
