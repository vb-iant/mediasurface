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

## mediasurface's own /blog: real content, read off local disk (2026-08-08, corrected same day)

`/blog` and `/blog/[slug]` used to render three static fixture files, kept
deliberately separate from real content, specifically to avoid a runtime
GitHub API dependency on a public route (an earlier version hit the GitHub
API live and produced a visible public error — see git history around
2026-08-07).

mediasurface is now a real site in `site-config.ts` (`content/blog` at the
repo root, same shape as the other three) — that part stands. Reasoning:
mediasurface needs to be a genuine admin-editable test/sandbox — build a
new schema field or display change, create/edit a test post through the
admin editor itself, and see it rendered. That requires real,
admin-editable content, which content/blog now is.

**Correction (same day):** `/blog` briefly read that content live via the
storage interface (GitHub API), dynamic/per-request — reintroducing a
`GITHUB_TOKEN` dependency on a public route, the same failure mode already
avoided once. That was wrong. `/blog` doesn't need the GitHub API at all:
`content/blog` is checked into THIS repo, the same repo mediasurface's own
app builds from, so it's already on disk at build time — no different
from how velocity-b's own deployed site will read its own content once
migrated onto this implementation (a repo reading its own checked-out
files, not calling out to GitHub for them). `/blog` and `/blog/[slug]` are
back to static generation (`generateStaticParams`, no
`export const dynamic`), reading via `src/lib/blog/local-content.ts` (`fs`
against `content/blog`), zero `GITHUB_TOKEN` dependency, verified by
building and running with the token completely unset.

The storage interface (GitHub API) is still exactly right for what the
admin's editor does — writing to mediasurface's own `content/blog`, or any
other site's repo remotely — because that's genuinely cross-repo access. A
repo reading its own files isn't; the earlier version conflated the two.

## Admin shell + site switcher (2026-08-08)

`/admin` and everything under it uses a route group,
`src/app/admin/(protected)/`, so the shared shell layout (nav, site
switcher, logout) wraps only authenticated pages — `/admin/login` stays
outside the group and renders with no shell chrome. Route groups don't
affect the URL, so this is purely a file-organization choice, not a
routing change.

Current site is tracked via a separate cookie, `ms_current_site` (distinct
from the `ms_session` auth cookie) — HttpOnly, 1-year expiry (it's UI
preference, not a session). The value is always re-validated against
`listSites()` server-side before being trusted, both when reading it
(`getCurrentSiteId()` falls back to the first non-sandbox site on anything
invalid/missing) and when setting it (the switch action rejects anything
not in the real site list, even though it should only ever receive a
value from the `<select>`).

`getCurrentSiteId()` defaults to the first real site, not `mediasurface` —
a fresh session should land somewhere with real editorial content, not
the test/sandbox.

## Post list view + two real bugs found and fixed (2026-08-08)

`/admin/posts` lists posts for the current site via `listPosts()`. Building
this against real content (not just velocity-b's already-proven 37 posts)
surfaced two genuine bugs in code previously marked "already built and
proven":

**1. `rockstarcmo`'s repo name was wrong in `site-config.ts`** —
`vb-iant/rockstarcmo` (no hyphen), when the real repo is
`vb-iant/rockstar-cmo`. `listDir` treats a 404 as "no posts yet" (a normal
state for a newly-onboarded site), not an error — so this typo would have
silently shown Rockstar CMO as empty in the admin, when it actually has
373 real migrated posts. Fixed. Worth remembering: a 404-tolerant design
choice (reasonable on its own) can mask a completely different problem
(wrong repo name) as a completely normal one (empty site) — the two look
identical from the caller's side.

**2. `listPosts()` had unbounded concurrency.** It fetched every post's
file with a plain `Promise.all` over all matching files at once — fine
against velocity-b's 37 posts, but firing 373 simultaneous requests
(rockstarcmo's real count) caused intermittent connection failures, even
though GitHub's actual rate limit (5000/hour) wasn't close to exhausted.
Fixed with a concurrency cap of 8 (`mapWithConcurrencyLimit` in
`src/lib/storage/posts.ts`). Confirmed via a standalone script that the
raw GitHub API handled all 373 fetches fine even unbounded — the failure
was about not opening hundreds of sockets from one process at once, not
about API quota.

Cost note carried over into the code comments: `listPosts()` is still one
GitHub API call per post (plus one to list the directory) — hundreds of
calls per page load for a large site. Fine at current usage, but if this
becomes a frequently-reloaded hot path, the Git Trees API (one recursive
call) would be a better fit than one Contents API call per file.

**Correction, same day (per Ian):** "373 rows rendered for rockstarcmo"
proves `listPosts()` doesn't crash on unfamiliar frontmatter. It does NOT
prove the display is correct. Confirmed directly against real post
frontmatter (`12-days-of-rockstar-cmo-christmas.md`,
`5-fin-fundamentals-marketing-operations.md`) — Rockstar CMO's real posts
(WordPress migration) diverge from the normalized schema in ways that
render silently wrong, not silently missing:

- `tags` is usually an empty array — real categorization lives in a
  `series` field the schema doesn't know about (e.g. `series:
  [the-magic-of-christmas-issue]`). The Posts table shows "—" for almost
  every Rockstar CMO post, which reads as "no tags" but is really "wrong
  field."
- `author` is a raw display name (`"Ian Truscott"`) plus a separate
  `authorSlug` — displays as text fine, but isn't the slug-based
  convention velocity-b uses, so anything resolving authors against
  `content/authors/*.md` later won't find a match.
- Featured image is `image`, not `featuredImage` — the post editor's
  image picker and OG toggle (already scoped in later tasks) will see
  nothing there once built, even though every post has one.
- Migration artifacts (`sourceId`, `sourceUrl`, `needsReview`,
  `excerptGenerated`) aren't part of the schema and are currently just
  silently dropped.

This is expected, already-scoped work — see the Rockstar CMO schema gaps
on the main board (`tm-1786117963464`) and the Phase 1→2 checkpoint
(`tm-1786118570378`). Real Rockstar CMO onboarding is schema-reconciliation
work that happens once the mediasurface reference implementation is
designed and built, not something the post list view was ever meant to
solve. **Velocity B and mediasurface are the two sites where this view's
output can currently be trusted; Rockstar CMO's is cosmetic-only until
that reconciliation happens.**

## Sites hidden from the switcher (2026-08-08)

`iantruscott` and `rockstarcmo` are hidden from selection (site switcher,
current-site validation) via `available: false` in `site-config.ts`,
rather than removed from the config entirely — the repo/path/schema info
stays intact for when each is genuinely ready, this just stops them being
selectable in the meantime. `listAvailableSites()` filters them out;
`listSites()` still returns everything configured, for anything that
genuinely needs the full list regardless of availability.

Both current-site validation paths respect this: `getCurrentSiteId()`
falls back to the default site if a stale/tampered cookie points at a
hidden one (verified — a cookie manually set to `rockstarcmo` after this
change correctly resets to Velocity B rather than showing an orphaned
selection), and the `switchSite` action rejects a direct POST to a hidden
site's id even if it bypasses the `<select>` (verified — no cookie is set,
same rejection path as an entirely invalid site id).

Currently selectable: `velocity-b`, `mediasurface`. Re-enable `iantruscott`
once its repo exists; re-enable `rockstarcmo` once the schema
reconciliation work (see above) is done.

**Instruction for any session working in this repo:** do not read, test
against, or re-enable `rockstarcmo` content as a matter of convenience —
not as a large-dataset stress test, not to "just check" something, not
because it's real data and everything else is small. It's hidden
specifically so there's no temptation to reach for it before the schema
work is scoped, even with good intentions (e.g. "let's verify pagination
against a bigger site" — don't; velocity-b and mediasurface are enough).
If a task genuinely seems to require touching `rockstarcmo`, stop and
confirm with Ian first, the same rule already in place for editing
`vb-iant/velocity-b` directly.

## Post list pagination (2026-08-08)

`/admin/posts` paginates at 20/page via `?page=` — no client JS, plain
`<Link>`s so it works without JS and stays simple. `listPosts()` still
fetches every post's frontmatter up front (see the cost note above) —
pagination only affects what's rendered, not how many GitHub API calls
`listPosts()` makes. If that ever becomes the bottleneck (not yet, at
current post counts and usage), it'd need pagination pushed down into the
storage interface itself, not just the page.

Out-of-range pages (e.g. a stale bookmark to `?page=5` after switching to
a site with fewer posts) clamp to the last valid page rather than showing
an empty page or erroring. Prev/Next links are disabled (`pointer-events-
none`, not removed) at the bounds — verified page 1, last page, and a
single-page site all render the correct disabled state.

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
patches to the existing code.

**Status as of 2026-09-04: all 9 tracked items done.** Scope grew from the
original 4 (below, kept for history) after a direct repo comparison found
more gaps than first assumed. Full list, CTRL board "Mediasurface Admin",
tracking task `tm-1786122063210`:

1. Draft/published enforcement — done
2. Multi-author rendering — **backlogged by Ian, not blocking** (`tm-1786120853654`). Built single-author-only; schema/loaders are author-count-agnostic (`normalizeAuthors()`) so multi-author UI can land later without a schema change.
3. OG-image source toggle + generation — done, see "OG image generation" section below
4. Reading-time calculation — done (`reading-time` package)
5. Author entity + author archive pages (`/blog/author/[slug]`) — done
6. Tags entity + tag rendering — done
7. Related posts (by shared tags) — done
8. Pagination + tag filtering (`?tag=`, `/blog/page/[pageNum]`) — done, built together deliberately since Velocity B treats them as one component
9. RSS feed (`/blog/rss.xml`) — done

Also done, net-new (not a Velocity B parity item — Velocity B has neither):
- 3-column grid layout (`src/components/blog/PostCard.tsx`), replacing the original bare inline-styled list, using Tailwind's default palette (Tailwind v4 was already configured in this repo but unused by the blog until this).
- 10 fixture posts / 5 tags with deliberately overlapping tags, added specifically so pagination and related-posts scoring have real data to demonstrate against, not just 2-3 placeholder posts.
- Author profile photos (`tm-1788540285021`) — Velocity B has no photo capability at all (initials-only avatar). `Author.avatar` existed in the schema since item 5 above but was unwired until this.

Migration is "done" (full site cutover) when `velocity-b.com` is actually
running on `mediasurface`'s blog implementation — that is **still not
done**. What's done is `mediasurface`'s reference implementation being
schema/feature-complete against Velocity B (multi-author aside, by
choice) — the explicit prerequisite before pointing the **Martech
Insiders** project at this schema as a content-structure reference (see
that project's own briefing/CLAUDE.md for its build).

This migration only covers *behavior that the current schema already
implies* (status, author, ogImageSource, reading time, tags) — it's a
narrower, more urgent thing than the longer-term "share front-end code
across all three sites" direction described below, which stays a Phase
1→2 question. This migration is Phase 1, and blocks nothing about that
later direction — it's simply making Velocity B honest about what its own
schema already claims to support, before Phase 2 adds more sites on top.

## OG image generation (2026-09-04)

Velocity B's real `lib/og.tsx` turned out to be far more site-specific
than the original 4-item scope assumed: hardcoded navy background
(`#0A1543`), Space Grotesk font loaded from specific Google Fonts URLs, a
hand-drawn chevron watermark (`<path d="M26 4 L80 50 L26 96" ...>`),
specific accent hex values, a "B" badge + "Velocity-B" name. None of that
is portable to another site as-is — a straight port would have been
wrong for every site except Velocity B.

**Resolution:** everything that was already just a VALUE (colors, font,
badge letter, site name) became a config field
(`src/lib/og/types.ts`'s `OgTemplateConfig`). The one thing that wasn't a
value — the bespoke chevron SVG — got reframed as "one configurable
watermark glyph, ghosted large in the background" (Ian's suggestion,
2026-09-04) rather than trying to generalize arbitrary SVG artwork. That
reframe is what made this shareable at all: Velocity B's chevron becomes
`watermarkGlyph: ">"`, Martech Insiders' would be `watermarkGlyph: "M"`,
etc.

Key pieces:
- `src/lib/og/theme-colors.ts`'s `readThemeColors()` parses a site's own
  `globals.css` for `--name: value;` custom properties via regex
  (deliberately not a full CSS parser — a small known file, not
  arbitrary CSS). Colors in `OgTemplateConfig` are CSS variable NAMES,
  not hex values, resolved at render time — change a color in the
  stylesheet, the OG image follows, nothing to keep in sync by hand.
- `src/lib/og/render.tsx`'s `renderOgImage(config, {eyebrow, title,
  accentIndex})` is the only file touching `ImageResponse`.
- Accent color cycles by a tag's position in `content/tags.json` order
  (`accentIndexForTag()` in `local-tags.ts`) — same tag always gets the
  same accent everywhere, matching Velocity B's `accentForTagIndex()`
  convention.
- `mediasurface`'s own config (`src/lib/og/mediasurface-config.ts`) is
  deliberately neutral — this repo has no real brand, the config exists
  to prove the mechanism works, not to look finished.

**What "shared" means here, importantly:** this is NOT a runtime package
imported across Velocity B / Martech Insiders / `mediasurface`'s separate
deployments — there's no shared package between these repos today. It
means the same pattern as everything else in this migration: the
renderer + config shape gets copied into a site's own repo with that
site's own config plugged in when it adopts this. Velocity B keeps its
existing bespoke `og.tsx` until/unless it migrates.

`ogImageSource`/`featuredImage` toggle: "featured" + a real
`featuredImage` serves that file's actual bytes directly (content-type
inferred from extension); anything else (including unset — defaults to
"generated" per the schema doc comment) generates a card. Verified both
branches against real fixtures, not just one: a `pricing-*` post fixture
has `ogImageSource: "featured"` pointing at a real SVG specifically to
exercise the branch every other fixture skips by default.

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

## Blog search (2026-09-07)

Added search to the reference blog implementation using Fuse.js, on top of
the audit-finding parity work below.

**Server-side, not client-side — deliberate choice.** The obvious "modern"
approach would be a client-side JSON search index shipped to the browser
for live-as-you-type matching. Rejected in favor of the simpler option:
`BlogIndexContent` was already a server component doing tag filtering
entirely via `Link`s + `searchParams` (`?tag=slug`), with zero client JS.
Search follows the exact same shape — a plain GET `<form>` submits to
`/blog?q=...`, Fuse.js runs server-side over the same post list
`getLocalPosts()` already loads for tag filtering, no index generation
step, no client component, no bundle-size cost. Consistency with the
existing pattern won out over the marginal UX gain of live-as-you-type on
a blog this size.

- `src/lib/blog/search.ts` — `searchPosts(posts, query)`. Self-contained
  (only depends on schema types + `local-tags`/`local-authors`), same
  "shared pattern, per-site copy" portability model as `local-content.ts`
  and the OG config — this file gets copied into a site's repo on cutover,
  not imported as a runtime package across repos.
- Weighted fields: title (0.5) > excerpt (0.25) > tag names (0.15) >
  author names (0.1), resolved to display names via `getAllTags()` /
  `getAllAuthors()` before indexing, not raw slugs.
- Search composes with tag filtering: `searchPosts()` runs on the
  already-tag-filtered list, so `/blog?tag=sales&q=deal` searches within
  the Sales tag rather than across all posts. `searchPosts()` is a no-op
  passthrough when `query` is empty, so `BlogIndexContent` calls it
  unconditionally rather than branching.
- Tag pills and pagination links preserve `q` via `URLSearchParams`
  (`tagHref()`/`pageHref()`); the search `<form>` carries the active tag
  as a hidden field so re-searching doesn't drop it. `PostCard`'s own
  primary-tag-pill links deliberately do NOT carry `q` — those represent
  "view this tag" from a specific post, not part of the filter bar, and
  predate this change.
- Empty-state message distinguishes "no posts found for this tag yet"
  (existing) from "no posts found for this search" (new) rather than one
  generic message for both.
- `fuse.js@^7.5.0` added as a dependency. One pre-existing unrelated
  `nanoid` transitive-dep vulnerability flagged by `npm audit` — not
  introduced by this change, not addressed here.

**Verified**: `npx next build` clean, then `npx next start` + curl against
real fixture content — a real search term, a nonsense term (empty state),
and a combined tag+search query all confirmed against actual HTTP
responses, not just a successful static build. Re-verified live against
`mediasurface.app` post-deploy the same way.

**Rollout**: built here first per the reference-implementation pattern.
Velocity B (dozens of posts) and Rockstar CMO (confirmed <500 posts, once
schema reconciliation is done) both fit comfortably within the size range
this server-side approach handles well — see CTRL task `tm-1788808951018`
for the full scale analysis (server-side Fuse.js assessed as fine up to
~500-1000 posts; a size-aware fork wasn't needed for any site currently in
scope).

## Velocity B parity audit (2026-09-07)

Ian caught a mismatch (an author box built on Velocity B that hadn't been
ported to `mediasurface`) and asked for a fuller comparison. Cloned both
repos and diffed `app/`, `components/`, `lib/` directly rather than
relying on memory of what was built — two real gaps found, one false
positive ruled out:

- **Date formatting — real gap, unfixed.** Velocity B's `lib/blog.ts` has
  `formatPostDate()` (`en-GB`, long month — "4 September 2026").
  `mediasurface`'s `local-content.ts` has no equivalent; `post.date` is
  rendered as the raw ISO frontmatter string. Logged as `tm-1788809131474`
  (Low priority), not yet fixed.
- **"Latest on Blog" / Featured Article module — backlogged, not a bug.**
  Velocity B's `components/blog/LatestOnBlog.tsx` is a single-post
  "Featured Article" widget for non-blog marketing pages (reuses the OG
  image as a thumbnail). `mediasurface` has no non-blog pages to place it
  on yet, so there's nothing to build it against. Logged as
  `tm-1788809138392` (Low priority) for whenever that changes.
- **`AuthorArchiveContent.tsx` — false positive, not a gap.** Velocity B
  splits author-archive rendering into its own component; `mediasurface`
  inlines the same logic directly in `app/blog/author/[slug]/page.tsx`.
  Same behavior, different file organization — confirmed by reading both,
  not assumed.
- `NewsletterSignup.tsx` on Velocity B is correctly absent — newsletter/
  subscribe is an explicitly separate tool decision, not blog/CMS scope
  (see `multi-site-admin-briefing.md`).

## Admin post-list search (2026-09-07)

Resolved `tm-1786201478243` ("Add search to post list view") — its open scoping questions are answered by what got built:

- **Server-side `?q=`**, same shape as `?page=` already used for pagination — confirmed by reading `src/app/admin/(protected)/posts/page.tsx` before building, not assumed.
- **Searches the full per-site list**, not just the current page — `listPosts(siteId)` already loads every post's full frontmatter up front (per the existing cost note on this), so filtering it for search needs no new fetch.
- **A new search resets to page 1** — the search `<form>` doesn't carry a `page` field, so submitting `?q=...` always lands on page 1 of the filtered set; `pageHref()` then carries `q` forward from there.

**Deliberately a separate module from the public blog's search** — `src/lib/storage/search-posts.ts` (`searchAdminPosts()`), not a reuse of `src/lib/blog/search.ts`. The blog's search resolves tags/authors to display names via `getAllTags()`/`getAllAuthors()`, which read `mediasurface`'s own local content — correct for the public `/blog` reference implementation, but wrong for the admin, whose post list comes from `listPosts(siteId)` via the storage interface and can be showing Velocity B, Rockstar CMO, or any future site. Per-site tag/author name resolution isn't wired up site-agnostically (only Velocity B has a real site-config entry), so the admin search matches raw fields already present on `PostSummary` — title, excerpt, tag slugs, author slug(s) — rather than resolved display names. Same Fuse.js weighting rationale (title > excerpt > tags > author) carried over regardless.

**Verified against real Velocity B content** (39 posts via `GITHUB_TOKEN`, not fixtures) using a locally-generated valid session token (same HMAC scheme as `src/lib/auth/session.ts`, local-only secret, never touching live credentials) to exercise the real password-gated route rather than stub around auth. Confirmed: unfiltered list (39 posts, page 1 of 2), a real search term matching an actual post title, a nonsense term producing the empty state, and pagination correctly preserving `q`.



- [x] `mediasurface` repo created, Next.js scaffold pushed.
- [x] Storage interface built and proven read-only against
      `vb-iant/velocity-b` (37 posts, real content).
- [x] Vercel project for `mediasurface` connected, custom domain
      `mediasurface.app` live.
- [x] Auth (password gate) built.
- [x] Admin shell + site switcher + post list view (paginated) built.
- [x] Blog front-end reference implementation built in `mediasurface` —
      see "Velocity B blog front-end migration" above for the full
      feature list (authors + photos, tags, related posts, pagination +
      filtering, RSS, OG images). All 9 originally-tracked items done as
      of 2026-09-04, only multi-author UI backlogged by choice.
- [ ] `savePost` tested against a live repo — deliberately deferred until
      the editor UI exists, to avoid test commits on a live site.
- [ ] Post editor UI (create/edit, wired to `getPost`/`savePost`) — not
      started. This remains the first real test of `savePost` against a
      live repo.
- [ ] Media manager (browse-everything view + context pickers) — not
      started.
- [ ] Velocity B site-switcher entry wired end-to-end (create/edit a post →
      commit → live on velocity-b.com).
- [ ] Migrate `velocity-b` onto `mediasurface`'s proven blog implementation
      (deliberate cutover, once ready — not incremental patches to the
      existing `lib/blog.ts`). Not started; the reference implementation
      being feature-complete (above) is the prerequisite for this, not
      the migration itself.
- [ ] Onboard iantruscott.com and Rockstar CMO once Velocity B path is
      proven — not before. Rockstar CMO also needs its own schema
      reconciliation first regardless (tags vs. series, image vs.
      featuredImage — see "Sites hidden from the switcher" above).
- [ ] Author profile photo UPLOAD (admin editor picker UI) — the
      front-end rendering is done (see above), but authors are still only
      editable by hand-editing markdown files; no author editor exists
      yet to attach an upload picker to.



