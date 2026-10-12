/**
 * "Why it matters / how to fix" copy for every finding the audit can raise,
 * keyed by finding id. One lookup shared by the public guide page
 * (/seo-guide, one anchor per id), the on-screen report, the PDF summary and
 * the Excel workbook — so the copy is written once.
 *
 * Copy approved by Ian 2026-10-12 (draft doc "SEO audit — fix guidance copy").
 * Written for a client's marketing lead, not a developer: plain UK English,
 * platform-neutral (says what to change, not where to click in a given CMS).
 * Severity is deliberately not repeated here — it comes from the check.
 *
 * Text may contain `backticks` for code; renderers show those as code (or
 * strip the backticks where code styling isn't available).
 *
 * The ids are public: they're the anchors on /seo-guide, and links to them
 * are embedded in PDFs and workbooks already sent to clients. Don't rename
 * an id without keeping the old anchor working.
 *
 * `node scripts/check-guidance.mjs` fails if a finding id in src/lib/seo has
 * no entry here, or an entry has no matching finding — run it after adding
 * or renaming a check.
 */

import type { Category } from "./checks/types";

export interface IssueGuidance {
  kind: "issue";
  /** Title as shown on the guide page (matches the finding's title). */
  title: string;
  /** The finding's category — used to place the entry under the same stage as the report. */
  category: Category;
  why: string;
  how: string;
}

/** Findings that describe the audit's own coverage, not a problem with the site. */
export interface NoteGuidance {
  kind: "note";
  title: string;
  category: Category;
  line: string;
}

export type Guidance = IssueGuidance | NoteGuidance;

const issue = (category: Category, title: string, why: string, how: string): IssueGuidance => ({
  kind: "issue",
  category,
  title,
  why,
  how,
});

const note = (category: Category, title: string, line: string): NoteGuidance => ({
  kind: "note",
  category,
  title,
  line,
});

export const GUIDANCE: Record<string, Guidance> = {
  // ── Discovery: sitemap, robots.txt, AI crawlers, site addresses ──────────
  "sitemap-missing": issue(
    "sitemap",
    "No XML sitemap found",
    "A sitemap is how you tell search engines which pages exist. Without one, they rely on finding every page through links.",
    "Publish an XML sitemap of every page you want in search, usually at /sitemap.xml. Most CMSs generate one automatically."
  ),
  "sitemap-not-in-robots": issue(
    "sitemap",
    "Sitemap not referenced in robots.txt",
    "Search engines check robots.txt first; listing the sitemap there means every crawler finds it, not just Google.",
    "Add a line to robots.txt: `Sitemap: https://www.example.com/sitemap.xml` (your full sitemap address)."
  ),
  "sitemap-bad-urls": issue(
    "sitemap",
    "Sitemap URLs that don't load directly",
    "The sitemap is meant to list final, working pages. Redirects or errors in it waste crawl time and make the sitemap less trusted.",
    "List each page's final address only. Remove pages that redirect, 404 or are excluded from search."
  ),
  "sitemap-wrong-host": issue(
    "sitemap",
    "Sitemap URLs use a different host or protocol",
    "If the sitemap says `http://` or no `www` but the site lives elsewhere, every listed URL is a redirect.",
    "Set the site's base URL in your CMS or sitemap settings to the address the site actually serves from."
  ),
  unlisted: issue(
    "sitemap",
    "Pages missing from the sitemap",
    "Pages left out may be found more slowly, or not at all if few pages link to them.",
    "Add these pages to the sitemap. If they're deliberately hidden (e.g. thank-you pages), mark them noindex instead."
  ),
  orphans: issue(
    "sitemap",
    "Orphan pages",
    "These pages are in the sitemap but nothing on the site links to them, so visitors can't find them and search engines treat them as unimportant.",
    "Link to each one from a relevant page or menu, or remove it from the sitemap if it's no longer needed."
  ),
  "robots-missing": issue(
    "sitemap",
    "No robots.txt file / robots.txt couldn't be read",
    "Not having one is fine; everything is crawlable. A robots.txt that errors can make crawlers back off the whole site.",
    "If it errors, fix the server so /robots.txt returns a plain text file (or a clean 404). Otherwise, no action needed."
  ),
  "blocked-by-robots": issue(
    "sitemap",
    "Linked pages blocked by robots.txt",
    "You link to these pages but tell search engines not to visit them. That's either deliberate or a rule that's broader than intended.",
    "Check each robots.txt rule matches only what you meant to block. If a page should stay out of search results, use noindex instead."
  ),
  "ai-search-blocked": issue(
    "ai",
    "AI search and answer bots are blocked",
    "Assistants like ChatGPT, Claude and Perplexity can only cite and link to pages they're allowed to read. Blocking them removes you from those answers.",
    "Allow the search and answer bots listed in the AI crawler panel in robots.txt. You can still block training crawlers separately."
  ),
  "hosts-failed": issue(
    "status",
    "Site address variants that don't work",
    "Some people and links will use `http://` or drop the `www`. If that version fails or goes somewhere else, those visitors are lost.",
    "Make every variant (http/https, with and without www) redirect permanently to your one main address."
  ),
  "hosts-duplicate": issue(
    "status",
    "Site served on more than one address",
    "The same site on two addresses splits ranking signals between them and can show the wrong version in search.",
    "Pick one address and permanently redirect (301) the others to it."
  ),
  "hosts-multi-hop": issue(
    "status",
    "Address variants that take several redirects",
    "Each extra hop adds a little delay and loses a little reliability.",
    "Redirect each variant straight to the final address in one step."
  ),
  "hosts-no-dns": issue(
    "status",
    "Address variants that don't exist",
    "Usually harmless; nobody can reach that variant at all.",
    "Optional: add a DNS record and redirect it, so anyone who types it still arrives."
  ),
  "hsts-missing": issue(
    "status",
    "No HSTS header",
    "HSTS tells browsers to always use the secure address, closing a small gap where the first visit could be intercepted.",
    "Add a `Strict-Transport-Security` header once the whole site works over HTTPS. Your host or CDN usually has a setting for it."
  ),

  // ── Crawl & status ───────────────────────────────────────────────────────
  "redirect-to-home": issue(
    "status",
    "Redirects to the homepage",
    "Sending removed pages to the homepage looks like a broken page to Google (a \"soft 404\") and confuses visitors who expected something specific.",
    "Redirect each old URL to its closest matching page. If nothing matches, let it return a proper 404 or 410."
  ),
  redirects: issue(
    "status",
    "Internal links pointing at redirects",
    "Each click goes via a redirect, adding a delay and diluting the link slightly.",
    "Update the links to point straight at the final address shown."
  ),
  "redirect-chains": issue(
    "status",
    "Redirect chains",
    "Several redirects in a row slow visitors down, and search engines may stop following before the end.",
    "Point the first URL directly at the final destination, and update any links to it."
  ),
  "offsite-redirects": issue(
    "status",
    "Internal links that redirect off the site",
    "A link that looks internal but lands on another domain is usually an old setting or a typo, and may send visitors somewhere unintended.",
    "Check each destination is intended. Link to it directly, or fix the redirect."
  ),

  // ── Links ────────────────────────────────────────────────────────────────
  "broken-links": issue(
    "links",
    "Broken links",
    "A link to one of your own pages, files or images that doesn't load is a dead end for visitors and a signal of neglect to search engines.",
    "Use the linking pages listed to update each link to the right address, or restore the missing page or file."
  ),
  "broken-external": issue(
    "links",
    "Broken external links",
    "A dead link to another site is still a dead end for your visitor, and makes the page look out of date.",
    "Update each link to the page's new address, link to an alternative source, or remove the link."
  ),
  "links-unverified": issue(
    "links",
    "Links we couldn't verify",
    "These sites blocked or rate-limited our automated check, which is common for LinkedIn, Instagram and large publishers. They usually work fine for people.",
    "No action needed. If one looks suspicious, open it in a browser to confirm."
  ),

  // ── On-page SEO ──────────────────────────────────────────────────────────
  "title-missing": issue(
    "onpage",
    "Missing page title",
    "The title is the clickable headline in search results and the label on the browser tab. Without one, Google writes its own.",
    "Give each page a unique title that says what it's about, ideally under 60 characters."
  ),
  "title-multiple": issue(
    "onpage",
    "More than one <title> tag",
    "Search engines have to guess which one you meant. Usually a theme and a plugin both adding one.",
    "Remove the duplicate so each page outputs exactly one title."
  ),
  "title-long": issue(
    "onpage",
    "Titles that may be truncated",
    "Long titles get cut off with \"…\" in search results, often losing the part that makes people click.",
    "Put the important words first and aim for under 60 characters. A guide, not a rule: Google cuts by width, not count."
  ),
  "title-duplicate": issue(
    "onpage",
    "Duplicate titles",
    "When several pages share a title, searchers can't tell them apart and search engines may pick the wrong one to show.",
    "Rewrite each title so it describes that specific page."
  ),
  "description-missing": issue(
    "onpage",
    "Missing meta description",
    "The description is the short summary under the title in search results. Without one, Google picks a snippet from the page, often a poor one.",
    "Write a one- or two-sentence summary per page that makes the case for clicking, under 160 characters."
  ),
  "description-multiple": issue(
    "onpage",
    "More than one meta description",
    "Search engines may use either, or neither.",
    "Remove the duplicate so each page outputs exactly one."
  ),
  "description-long": issue(
    "onpage",
    "Meta descriptions that may be truncated",
    "Long descriptions get cut off in search results.",
    "Lead with the key point and aim for under 160 characters."
  ),
  "description-duplicate": issue(
    "onpage",
    "Duplicate meta descriptions",
    "Identical summaries make different pages look the same in search results.",
    "Write a description specific to each page."
  ),
  "h1-missing": issue(
    "onpage",
    "Missing H1 heading",
    "The H1 is the page's main visible heading. It tells visitors and search engines what the page is about, and screen readers rely on it.",
    "Add one clear main heading near the top of the page, marked up as an H1."
  ),
  "h1-multiple": issue(
    "onpage",
    "More than one H1 heading",
    "Not harmful on its own, but it often means headings are used for styling rather than structure, which makes the page's outline unclear.",
    "Keep one H1 for the main heading and use H2/H3 for sections."
  ),
  "canonical-missing": issue(
    "onpage",
    "No canonical tag",
    "A canonical tag tells search engines which address is the master copy of a page, which protects against duplicates from tracking links or URL variants.",
    "Add a self-referencing canonical tag to each page. Most CMSs and SEO plugins do this with one setting."
  ),
  "canonical-multiple": issue(
    "onpage",
    "More than one canonical tag",
    "Conflicting canonicals are usually ignored altogether, so you lose the protection.",
    "Remove the extra one so each page declares a single canonical."
  ),
  "canonical-off-site": issue(
    "onpage",
    "Canonical points to another domain",
    "You're telling search engines another website owns this page's content, which can remove your page from search. Often a staging or preview domain left in settings.",
    "Change the canonical to the page's own address on your live domain. Check the site's base URL setting."
  ),
  "canonical-wrong-host": issue(
    "onpage",
    "Canonical uses a different host or protocol",
    "The canonical points at the http or non-www version, which then redirects, sending mixed signals.",
    "Set the canonical to the exact address the page serves from."
  ),
  "canonical-elsewhere": issue(
    "onpage",
    "Canonical points to a different page",
    "Fine if deliberate (e.g. a print version pointing at the original). If not, the page won't appear in search.",
    "Check each one is intended. If the page should rank on its own, point its canonical at itself."
  ),
  "canonical-broken": issue(
    "onpage",
    "Canonical points to a broken or redirected page",
    "Search engines are told the master copy is a page that doesn't work, so they may ignore the canonical or drop the page.",
    "Point the canonical at a working, final address, usually the page itself."
  ),
  noindex: issue(
    "onpage",
    "Pages excluded from search (noindex)",
    "These pages ask not to appear in search results. Often deliberate (thank-you pages, archives); occasionally a leftover setting on a page that should rank.",
    "Check the list. Remove noindex from any page you want found."
  ),
  "noindex-in-sitemap": issue(
    "onpage",
    "noindex pages listed in the sitemap",
    "The sitemap asks search engines to index a page that asks not to be indexed. A contradiction that wastes crawl effort.",
    "Either remove noindex (if the page should rank) or take it out of the sitemap."
  ),
  "lang-missing": issue(
    "onpage",
    "No page language set",
    "The language attribute tells browsers, screen readers and translation tools what language the page is in.",
    "Add the language to the page's html tag, e.g. `lang=\"en-GB\"`. Usually one site-wide setting."
  ),
  "og-missing": issue(
    "onpage",
    "Missing social sharing tags",
    "When the page is shared on LinkedIn, Slack or WhatsApp, these tags control the title, summary and image shown. Without them the preview is often blank or wrong.",
    "Add Open Graph title, description and image tags. Most SEO plugins and frameworks have fields for them."
  ),
  "img-alt-missing": issue(
    "onpage",
    "Images without alt text",
    "Alt text describes images to people using screen readers and to search engines, and shows if an image fails to load. It's also an accessibility requirement.",
    "Add a short description to each meaningful image. Decorative images should have an empty alt (`alt=\"\"`), not none."
  ),
  slow: issue(
    "onpage",
    "Slow server responses",
    "The page can't start loading until the server answers. A slow first response delays everything after it, for visitors and crawlers.",
    "Check page caching on your host or CMS, and whether these pages run slow database queries or plugins. Measured from our server, so treat as a guide."
  ),
  large: issue(
    "onpage",
    "Very large HTML",
    "Very large pages take longer to download and process, especially on mobile, and may be cut short by crawlers.",
    "Look for large inline scripts, embedded data or images, or very long lists that could be split across pages."
  ),
  "viewport-missing": issue(
    "onpage",
    "No mobile viewport tag",
    "Without it, phones show a shrunken desktop page. Google judges sites on their mobile version, so this affects rankings directly.",
    "Add `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">` to the page head, usually in the site template."
  ),
  "mixed-content": issue(
    "onpage",
    "Insecure content on secure pages",
    "Browsers block images, scripts or styles loaded over http on an https page, so parts of the page break or show security warnings.",
    "Change those resource addresses to https, or host the files on your own site."
  ),
  "url-hygiene": issue(
    "onpage",
    "Untidy URLs",
    "Very long URLs, uppercase letters, spaces or underscores are harder to read and share, and can create duplicate versions of a page.",
    "For new pages, use short lowercase addresses with hyphens. Don't change existing URLs without a redirect."
  ),
  "thin-pages": issue(
    "onpage",
    "Pages with very little text",
    "Pages with under about 200 words of their own content give search engines little to understand or rank.",
    "Expand pages that should rank with useful detail. Fine to leave contact or form pages as they are."
  ),
  "hreflang-invalid": issue(
    "onpage",
    "Invalid hreflang language codes",
    "hreflang tells search engines which language or country version to show. Invalid codes are ignored entirely.",
    "Use valid codes such as `en`, `en-GB` or `fr-FR` (language, then optional country)."
  ),
  "hreflang-no-return": issue(
    "onpage",
    "hreflang alternates that don't link back",
    "Search engines only trust a language pairing if both pages point at each other.",
    "Make sure every language version lists all the others, including itself."
  ),
  "hreflang-broken": issue(
    "onpage",
    "hreflang alternates that don't load",
    "Pointing at a broken page means visitors in that market may be sent to an error.",
    "Fix or update the alternate addresses so each one loads directly."
  ),
  "hreflang-no-default": issue(
    "onpage",
    "No x-default hreflang",
    "x-default says which version to show visitors who don't match any listed language. Optional but recommended.",
    "Add an x-default entry pointing at your main or language-picker page."
  ),

  // ── Site structure ───────────────────────────────────────────────────────
  "deep-pages": issue(
    "structure",
    "Pages more than 3 clicks deep",
    "Pages buried deep in the site get visited less by crawlers and are treated as less important. Visitors rarely dig that far either.",
    "Link to them from higher-level pages: category pages, related-content links, or the main menu for key pages."
  ),
  "single-inlink": issue(
    "structure",
    "Pages with only one internal link",
    "Internal links tell search engines which pages matter. A page with a single link is easy to overlook and easy to orphan by accident.",
    "Add links from two or three relevant pages, using descriptive link text."
  ),

  // ── Structured data ──────────────────────────────────────────────────────
  "schema-invalid": issue(
    "schema",
    "Structured data that doesn't parse",
    "Structured data is code that describes the page to search engines (an article, a business, a product). If it has a syntax error, it's ignored completely.",
    "Fix the JSON-LD syntax, often a missing comma or quote. Google's Rich Results Test shows the exact error."
  ),
  "schema-incomplete": issue(
    "schema",
    "Structured data missing key properties",
    "Without required details (such as an article's image or date), the page can't qualify for richer search listings.",
    "Add the missing properties listed. Check with Google's Rich Results Test."
  ),
  "schema-none": issue(
    "schema",
    "No structured data found",
    "Not required, but it helps search engines and AI assistants understand who you are and what each page is, and enables richer listings.",
    "Start with Organization and WebSite markup on the homepage and Article markup on blog posts. Most SEO plugins add these."
  ),
  "schema-home-no-org": issue(
    "schema",
    "Homepage has no Organization or WebSite markup",
    "This markup tells search engines your business name, logo and social profiles, which feeds the panel shown when people search for you by name.",
    "Add Organization (or LocalBusiness) and WebSite markup to the homepage."
  ),
  "schema-summary": issue(
    "schema",
    "Structured data on this site",
    "A summary of the types found, for reference.",
    "No action needed."
  ),

  // ── Speed & weight ───────────────────────────────────────────────────────
  "images-heavy": issue(
    "performance",
    "Very large images",
    "Images over 300 KB are usually the biggest single cause of slow pages, especially on mobile data.",
    "Resize to the size actually displayed and compress, ideally as WebP or AVIF. Most images can drop 70–90% with no visible difference."
  ),
  "images-large": issue(
    "performance",
    "Large images",
    "Images of 150–300 KB add up quickly on pages with several of them.",
    "Compress them and serve modern formats (WebP/AVIF) where your platform allows."
  ),
  "images-uncached": issue(
    "performance",
    "Images browsers must re-check every visit",
    "Repeat visitors' browsers ask the server whether each image has changed. Usually a quick check, but it adds requests.",
    "Set a long cache lifetime for images that rarely change (e.g. a year), via your host or CDN."
  ),
  "html-uncompressed": issue(
    "performance",
    "Pages served without compression",
    "Compression (gzip or Brotli) typically shrinks pages by 70% or more, so uncompressed pages load more slowly for no benefit.",
    "Turn on gzip or Brotli compression in your hosting, server or CDN settings."
  ),

  // ── Page speed ───────────────────────────────────────────────────────────
  "speed-poor": issue(
    "speed",
    "Slow pages on mobile",
    "A performance score under 50 means the page feels slow on a typical phone. Slow pages lose visitors and rank lower.",
    "Start with the page's speed diagnosis: large images, render-blocking scripts and styles, and heavy third-party tags are the usual causes."
  ),
  "speed-needs-work": issue(
    "speed",
    "Pages that could be faster on mobile",
    "Scores of 50–89 are acceptable but leave room to improve. Scores vary between runs, so small differences are noise.",
    "Run the speed diagnosis on the worst pages and fix the top items. Fixes in shared templates improve many pages at once."
  ),
  "field-poor": issue(
    "speed",
    "Real mobile visitors get a poor experience",
    "This is measured from real Chrome users, not a lab test, and it is the data Google uses as a ranking signal.",
    "Focus on the metric marked poor (loading, responsiveness or layout shift). Lab diagnoses show the likely causes."
  ),
  "field-needs-work": issue(
    "speed",
    "Real mobile visitors' experience needs improvement",
    "Real-visitor data shows the site is borderline on at least one measure Google uses.",
    "Target the metric flagged, then re-check after 28 days, since real-visitor data is a rolling average."
  ),

  // ── About the audit (coverage notes, not site problems) ──────────────────
  "sitemap-truncated": note(
    "sitemap",
    "Sitemap only partly read",
    "The sitemap was larger than the audit reads (5,000 URLs), so sitemap comparisons cover only part of it."
  ),
  "links-external-skipped": note(
    "links",
    "External links weren't checked",
    "External link checking was switched off for this audit, so dead links to other sites aren't included."
  ),
  "links-not-checked": note(
    "links",
    "Some links weren't checked",
    "The audit stopped at its link-check limit (3,000), so some links weren't tested."
  ),
  "links-check-stopped": note(
    "links",
    "Link checks stopped early",
    "Link checking was stopped before it finished, so link results are incomplete."
  ),
  "speed-failed": note(
    "speed",
    "Pages that couldn't be speed-tested",
    "Google's speed test didn't return a result for these pages. Usually temporary; re-running the test normally works."
  ),
};

/** Public address of the guide; the PDF and workbook link to `${GUIDE_URL}#<id>`. */
export const GUIDE_URL = "https://www.mediasurface.app/seo-guide";

export function guideLink(findingId: string): string | null {
  return GUIDANCE[findingId] ? `${GUIDE_URL}#${findingId}` : null;
}

export function guidanceFor(findingId: string): Guidance | undefined {
  return GUIDANCE[findingId];
}

/** Text with `code` markers removed, for outputs that can't style code (PDF, workbook). */
export function plainText(s: string): string {
  return s.replace(/`/g, "");
}

/** Splits text into plain and `code` segments, for renderers that style code. */
export function codeSegments(s: string): { text: string; code: boolean }[] {
  return s.split("`").map((text, i) => ({ text, code: i % 2 === 1 })).filter((seg) => seg.text !== "");
}
