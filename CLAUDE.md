# mediasurface — Architecture & Decisions

Multi-site admin app for managing content (pages, blog posts, media) across
Ian's sites. Replaces the previous "one-off admin per site" approach. This
file is the versioned record of real architectural decisions — update it
whenever a decision actually lands in chat, the same habit as updating Notion
for copy. Don't let decisions live only in chat memory.

@AGENTS.md

## Purpose

One shared admin, not one admin per site. Own repo, own Vercel project,
deployed independently — if the admin goes down, the sites it manages stay
up, since they're separate Vercel projects reading from their own repos.

## Sites managed

| Site | Repo | Content shape |
|---|---|---|
| **mediasurface (test/sandbox)** | `vb-iant/mediasurface` (self) | Not a real editorial site. Where new front-end functionality (schema fields, display logic) is built and tested end-to-end — editor UI included — before being ported to the real sites below. |
| Velocity B (velocity-b.com) | `vb-iant/velocity-b` | Pages + blog (multi-author, tags, reading time, related posts, OG images) |
| iantruscott.com | TBD (not yet created) | Pages + blog ("Ideas"). Newsletter/subscribe is a separate tool decision, not CMS scope. |
| Rockstar CMO (rockstarcmo.com) | TBD (migration in progress) | Pages + blog posts only. **Podcast episodes are NOT admin content** — pulled live via RSS/ISR on the site side. |

## Core architecture decisions

1. **GitHub-backed content, not a database (for now).** A future move to
   Postgres/Vercel Blob is anticipated but not urgent.
2. **Thin storage interface** sits between the admin/site pages and GitHub —
   `getPost(site, slug)`, `savePost(site, slug, data)`, `listPosts(site)`,
   `saveMedia(site, file)`. The admin UI and each site's schema are built
   against this interface, not the GitHub API directly, so a later DB
   migration only means rewriting the interface's implementation.
3. **Site-config layer** routes the admin to the right repo/branch/schema per
   site (see `site-config.json` once created — repo, branch, contentPath,
   schema per site).
4. **One normalized blog schema** shared across all sites: title, slug, date,
   excerpt, body, featured image, tags, author (multi-author-capable),
   status, SEO title/description, computed reading time. Pages stay
   per-site since page shapes differ more. Podcast episodes are explicitly
   excluded from this schema.
5. **Each site deploys exactly as it does now.** Admin writes to a site's
   repo via the batched blob→tree→commit→ref sequence; Vercel notices the
   push and deploys on its own. **No Vercel API calls from the admin.**
6. **Auth: simple password gate on `/admin/*` only.** Built 2026-08-08.
   Server-side, HttpOnly signed session cookie (`ms_session`), HMAC-SHA256
   via Web Crypto, 1-day expiry. No per-user accounts needed at this scale
   (Ian + Alex). Scope corrected from an earlier "gate the whole app"
   framing — the homepage and `/blog` are intentionally public and were
   never touched. Login lives at `/admin/login`; everything else under
   `/admin` requires a valid session. Implemented in `src/proxy.ts` (not
   `middleware.ts` — Next.js 16 renamed the convention; a leftover
   `middleware.ts` is silently ignored at runtime with no build error, so
   this matters if anyone's tempted to "restore" the old filename).
   Requires `ADMIN_PASSWORD` and `AUTH_SECRET` env vars, set directly in
   Vercel (Production + Preview) — never committed, see the incident note
   in `mediasurface-github-credentials.md`-style project knowledge about
   why these get generated and handed over out-of-band rather than
   round-tripped through a file in the repo.

## Deliberately out of scope

- Database migration (Postgres + Vercel Blob) — anticipated, not now.
- Client-hosted / multi-tenant SaaS pivot — not now, possibly not ever.
  Don't architect for it pre-emptively.
- iantruscott.com's newsletter/subscribe replacement — separate decision.
- Per-client auth/isolation — only relevant if this ever hosts non-Ian sites.

## GitHub access

- One GitHub PAT is currently used across repos (`vb-iant/*`). The doc's
  original guidance was one fine-grained PAT per repo for a smaller blast
  radius per leak — the broader token is a deliberate, known trade-off
  carried over from another project where per-repo scoping wasn't working,
  not an oversight. Fine to keep; revisit scoping later if needed.
- Token lives in project knowledge / environment, never committed. Read via
  `GITHUB_TOKEN` env var or `--token-file` at runtime — see
  `scripts/github_batch.py`.
- Reads go through the Contents API
  (`api.github.com/repos/.../contents/...?ref=main`), not
  `raw.githubusercontent.com`, which caches aggressively.

## Committing changes: use `scripts/github_batch.py`

Batches every change into a single commit via the Git Data API
(blob → tree → commit → ref) — never one file per commit.

```
export GITHUB_TOKEN=ghp_xxx
python3 scripts/github_batch.py \
  --repo vb-iant/mediasurface \
  --branch main \
  --local-dir . \
  --message "Describe the change" \
  --exclude-dir node_modules,.next,.git
```

**Known gotcha:** GitHub's Git Data API refuses to create blobs at all on a
repo with zero commits — it needs one file written via the simpler Contents
API first to get an initial commit, only then does blob→tree→commit→ref
work. The script already handles this automatically (falls back to creating
the ref fresh when no branch exists yet), but if bootstrapping a *brand new*
repo manually, create one file via the Contents API first.

**Known gotcha (found + fixed 2026-08-07): deletions weren't handled.**
Removing a local file and running the script did NOT remove it from the
repo — a new tree built with `base_tree` merges with everything already
there by default; anything not explicitly re-specified just carries
forward unchanged. GitHub only deletes a path when given an explicit tree
entry with `sha: null`. The script now fetches the remote tree, diffs it
against the local file set (scoped to the same `--include-ext`/
`--exclude-dir` filters as the push itself, so a partial push like
`--include-ext .md` doesn't wrongly delete unrelated file types), and adds
null-SHA entries for anything that's disappeared locally. **This means any
commit made with the version of this script before this fix could have
left orphaned files on GitHub that looked deleted locally but weren't** —
worth a quick manual check on any repo where files were removed locally
and pushed before 2026-08-07's fix landed.

**Always re-fetch the branch's current SHA immediately before every write** —
a stale SHA causes a 409 conflict, and this matters more with multiple repos
and sessions in play.

## Build checks

Run a full `next build` (not just an `esbuild`/type-check pass) before every
push — `esbuild` doesn't catch TypeScript type conflicts that a real build
will.

## mediasurface's own /blog: now live, not fixtures (2026-08-08)

`/blog` and `/blog/[slug]` used to render three static fixture files bundled
at build time, specifically to avoid a runtime GitHub API dependency on a
public route (an earlier version hit the GitHub API live and produced a
visible public error — see git history around 2026-08-07).

That's been deliberately reversed. mediasurface is now a real site in
`site-config.ts` (`content/blog` at the repo root, same shape as the other
three), and `/blog` reads live via the storage interface
(`getPost`/`listPosts`), dynamic/per-request (`export const dynamic =
"force-dynamic"`). Reasoning: mediasurface needs to be a genuine
admin-editable test/sandbox — build a new schema field or display change,
create/edit a test post through the admin editor itself (not just hand-edit
a fixture file), and see it rendered immediately. That requires real,
live-editable content.

**Consequence worth remembering:** `/blog` now depends on `GITHUB_TOKEN` at
runtime, same as the rest of the admin — and unlike the admin routes,
`/blog` is public, not behind the password gate. If `GITHUB_TOKEN` is ever
missing/invalid in Vercel, `/blog` breaks publicly, not just the admin.
Same risk category as before, deliberately re-accepted this time because
the token dependency already exists everywhere else in this app — this
isn't a new category of fragility, just extending an existing one to one
more route.

## Vercel

- No Vercel API token needed or used — Claude never calls the Vercel API
  directly. Vercel connects to each GitHub repo with auto-deploy on push to
  `main`. Verify a deploy by fetching the live URL after a ~30–60s wait.
- This admin app needs its own Vercel project, connected to this repo,
  separate from the three site projects.
- Pro plan is in place, so account-wide deploy rate limits are a smaller
  concern, but the one-commit-per-deploy discipline still matters with
  multiple projects sharing the account.

## Risk: parallel chat sessions on the same repo

Two chats can each fetch a file, form a plan, then both try to write. The
re-fetch-SHA-before-write discipline catches the loud failure (409, stale
SHA). It does *not* catch the quiet case where both commits succeed but
leave the repo in a state neither chat individually intended (e.g. two
files that each assume something different about shared state, like a
schema). Practical mitigation: avoid running two chats against the same
repo at the same time.

## Media paths

Three separate top-level paths, not one flat folder — `public/images/`,
`public/documents/`, `public/media/` (video/audio/other). Deliberately not
nested under a shared `media/` root. Decided 2026-08-07. Rationale:

- `listDir()` fetches an entire directory per call — separate folders mean
  the admin only pulls back what it actually needs (e.g. "show images"
  doesn't also fetch every PDF).
- Featured images are tightly coupled to post frontmatter (picked via an
  editor image picker); PDFs are standalone downloadable Resources assets
  linked from elsewhere — different UX, no reason to force them through one
  browse view.
- Cleaner URLs for shared/downloaded assets, e.g. `/documents/guide.pdf`
  rather than a PDF sitting among hashed image filenames.
- Deliberately **no migration** of Velocity B's existing `public/images/`
  content (author avatars etc.) — those stay exactly where they are, since
  they're referenced directly by `content/authors/*.md` and moving them
  would risk breaking live references for no real benefit. `imagesPath`
  simply continues pointing at the same existing folder; `documentsPath`
  and `mediaPath` are net-new, empty until first used.

`saveMedia(site, kind, filename, buffer)` — `kind` is `"image" | "document"
| "media"` and picks the right path automatically.

No cross-site shared asset store — each site owns its own media in its own
repo, same as it owns its own content. `mediasurface` is the shared editing
interface, never a storage location itself. If a genuine shared-asset need
appears later (e.g. common branding across all sites), revisit then —
likely Vercel Blob, per the deferred DB/storage migration item — rather
than architecting for it now.

## Velocity B blog front-end migration

Named 2026-08-07, direction settled same day (see "Validation process"
above). `mediasurface` builds the reference blog implementation;
`velocity-b`'s live front-end (`lib/blog.ts` and templates) is not touched
during development — it gets migrated onto `mediasurface`'s implementation
once that's proven, as a deliberate cutover, not a series of incremental
patches to the existing code. Scope for the initial `mediasurface`
implementation, informed by what's missing from `velocity-b`'s current
code (found by reading it as reference, not by editing it):

1. Draft/published enforcement — `velocity-b` currently has none at all
2. Multi-author rendering — decide if wanted; `velocity-b` only handles a single author string today
3. OG-image source toggle (generated card vs. featured image)
4. Reading-time calculation — one implementation, not duplicated later

Migration is "done" when `velocity-b` is running on `mediasurface`'s blog
implementation and its live behavior matches what was proven there —
tracked as a single checklist, not disconnected fixes to the old code.

This migration only covers *behavior that the current schema already
implies* (status, author, ogImageSource, reading time) — it's a
narrower, more urgent thing than the longer-term "share front-end code
across all three sites" direction described below, which stays a Phase
1→2 question. This migration is Phase 1, and blocks nothing about that
later direction — it's simply making Velocity B honest about what its own
schema already claims to support, before Phase 2 adds more sites on top.

## Front-end normalization

**Scope shifted 2026-08-07.** Originally framed as future work, deferred to
the Phase 1→2 checkpoint once a second site's front-end existed to compare
against. That framing was wrong: it's already Phase 1 work.

Reason for the shift: content schema being shared doesn't mean *behavior*
is — a schema field like `status` or `author` (array) only means something
on a site whose front-end code actually implements it. Auditing Velocity
B's own `lib/blog.ts` and blog templates (2026-08-07) found the site
doesn't yet correctly implement the schema `mediasurface`'s admin is about
to write to:

- **No draft/published enforcement at all.** `getAllBlogPosts()` and
  `generateStaticParams()` read and publish every `.md` file in
  `content/blog` unconditionally — `status` isn't even a field on
  `BlogPostFrontmatter`. A draft saved via the admin would go live
  immediately, silently. Real risk, not theoretical — the post editor's
  first live `savePost` test happens against this repo.
- **Author is hard-coded single-string throughout rendering**
  (`getAuthorBySlug`, `getPostsByAuthor`, `PostCard`, post-detail page) —
  the schema's `string | string[]` "multi-author-capable" forward
  compatibility exists only in the admin's schema, not in the site that
  would need to render it.
- **Reading time computed independently in two places** with two different
  implementations (Velocity B's own word-count/200wpm vs. `mediasurface`'s
  use of the `reading-time` package) — no guarantee they always agree on
  the same post.

**Revised direction:** fixing Velocity B's own front-end to correctly and
completely implement the schema is now part of *this* project's Phase 1
scope — a prerequisite for trusting the admin, not a nice-to-have deferred
to onboarding a second site. The longer-term "share code across sites"
direction (still option 3, still Velocity B as reference model once a real
second consumer exists) is unchanged and still belongs at the Phase 1→2
checkpoint — this is a narrower, more urgent fix: make Velocity B honest
about the schema it already claims to support, before building more on top
of an admin that can silently produce content the site mishandles.

**Direction settled 2026-08-07 (final):** `mediasurface` builds and owns
the reference blog front-end implementation. `velocity-b`'s existing code
is a reference only — not edited, not tested against, not touched. Once
the blog implementation in `mediasurface` is right, `velocity-b` migrates
onto it (its own `lib/blog.ts`/templates get replaced, not incrementally
patched). All future blog enhancements get built and tested in
`mediasurface` first, then rolled out to sites — `mediasurface` is
upstream, sites are downstream. (Two earlier approaches were tried and
abandoned same day — a public `mediasurface.app/blog` route, then a
`velocity-b` feature-branch/Vercel-preview approach — see git history for
that back-and-forth if useful context, but this is the settled direction.)

## Storage interface

Implemented in `src/lib/storage/posts.ts`, on top of `src/lib/github/client.ts`
(single-file reads/writes via the Contents API) and `src/lib/sites/config.ts`
(per-site repo/branch/path routing). Schema types in `src/lib/storage/schema.ts`.

- `listPosts(site)` — lightweight summaries (frontmatter only, no body), for
  the admin's post-list view.
- `getPost(site, slug)` — full post (frontmatter + body + computed reading
  time).
- `savePost(site, slug, data)` — create/update. Not yet exercised against a
  live repo — hold off testing real writes until the editor UI exists.
- `saveMedia(site, filename, buffer)` — uploads to the site's media path,
  returns the public path.
- `deletePost` / `postExists` also added, beyond the original four-function
  list, since the admin will need them.

**Proven against real Velocity B content** (`scripts/smoke-test-storage.ts`,
read-only): `listPosts("velocity-b")` correctly returns all 37 posts, sorted
newest-first; `getPost` correctly parses frontmatter and computes reading
time (verified: 6,646-char body → "6 min read").

Frontmatter shape confirmed from real Velocity B posts: `title`, `slug`,
`date`, `author` (currently always a single string across all 37 posts —
schema accepts `string | string[]` for forward-compatible multi-author
support), `tags`, `excerpt`, and an optional `originalUrl` migration
artifact. `featuredImage`, `status`, `seoTitle`, `seoDescription` are in the
schema per the doc's spec but not yet present on existing posts.

**Token resolution:** `github/client.ts` checks for a per-repo env var first
(e.g. `GITHUB_TOKEN_VELOCITY_B`) before falling back to `GITHUB_TOKEN` — so
splitting into fine-grained per-repo PATs later needs no code changes.

## Status / next steps

- [x] `mediasurface` repo created, Next.js scaffold pushed.
- [x] Storage interface built and proven read-only against
      `vb-iant/velocity-b` (37 posts, real content).
- [ ] Vercel project for `mediasurface` connected (in progress — custom
      domain `mediasurface.app` acquired).
- [ ] Auth (password gate) built.
- [ ] Blog front-end built in `mediasurface` (index + post pages) — the
      reference implementation for how blogs should work across all
      sites. Not `velocity-b` — that stays untouched, reference only.
- [ ] `savePost` tested against a live repo — deliberately deferred until
      the editor UI exists, to avoid test commits on a live site.
- [ ] Admin UI: post list + editor, wired to the storage interface.
- [ ] Velocity B site-switcher entry wired end-to-end (create/edit a post →
      commit → live on velocity-b.com).
- [ ] Migrate `velocity-b` onto `mediasurface`'s proven blog implementation
      (deliberate cutover, once ready — not incremental patches to the
      existing `lib/blog.ts`).
- [ ] Onboard iantruscott.com and Rockstar CMO once Velocity B path is
      proven — not before.



