// Author box — shown at the bottom of a post, mirroring Velocity B's
// app/blog/[slug]/page.tsx author-box block (avatar, name+link, role,
// bio, LinkedIn CTA inside a bordered card). Extracted as a shared
// component here rather than inlined in the route, and restyled to this
// repo's slate/blue palette instead of Velocity B's navy/orange —
// otherwise a straight port of that block's content and structure.
//
// Accepts the same `author: string | string[]` shape as AuthorByline and
// resolves the same way (normalizeAuthors + getAuthorBySlug), so it's
// author-count-agnostic rather than assuming single-author the way
// Velocity B's inline version can (it has no multi-author posts in its
// own data). Multi-author UI is still backlogged overall
// (tm-1786120853654); this just doesn't hardcode around it here.
//
// Renders nothing for a slug with no matching profile — no name, bio, or
// link exists to show, so there's nothing worth a card for (unlike
// AuthorByline, which falls back to the raw slug in a byline context).

import Link from "next/link";
import { getAuthorBySlug } from "@/lib/blog/local-authors";
import { normalizeAuthors } from "@/lib/storage/schema";
import { AuthorAvatar } from "@/components/blog/AuthorAvatar";

export function AuthorBox({ author }: { author: string | string[] }) {
  const authors = normalizeAuthors(author)
    .map((slug) => getAuthorBySlug(slug))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  if (authors.length === 0) return null;

  return (
    <div className="my-11 flex flex-col gap-6">
      {authors.map((a) => (
        <div
          key={a.slug}
          className="flex items-start gap-5 rounded-lg border border-slate-200 bg-slate-50 p-7"
        >
          <AuthorAvatar author={a} size={64} />
          <div>
            <h3 className="mb-1 text-lg font-bold">
              <Link href={`/blog/author/${a.slug}`} className="hover:text-blue-600">
                {a.name}
              </Link>
            </h3>
            {a.role && (
              <div className="mb-2 text-xs font-semibold text-blue-600">{a.role}</div>
            )}
            {a.bio && (
              <p className="mb-2 text-[15px] leading-relaxed text-slate-700">{a.bio}</p>
            )}
            {a.linkedin && (
              <a
                href={a.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-blue-600"
              >
                Follow {a.name.split(" ")[0]} on LinkedIn &rarr;
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
