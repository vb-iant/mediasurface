// Shared author avatar — renders the real photo (Author.avatar) when set,
// falling back to initials-in-a-circle otherwise. The fallback mirrors
// Velocity B's PostCard.tsx initials() convention exactly (first letter
// of each word, max 2 characters, uppercased) — Velocity B has NO photo
// capability at all, so that initials treatment is its only avatar; this
// component adds the photo as the preferred option on top of the same
// fallback, rather than replacing it.
//
// Plain <img>, not next/image: an SVG source (this repo's fixture uses
// one) needs next.config's dangerouslyAllowSVG to go through next/image's
// optimizer, which is unnecessary complexity/risk for a small fixed-size
// avatar. Velocity B's own ReactMarkdown image override (for in-article
// images) uses plain <img> for the same reason — not mirrored elsewhere
// in mediasurface's own markdown rendering yet, but the same reasoning
// applies here.

import type { Author } from "@/lib/storage/schema";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AuthorAvatar({
  author,
  size = 24,
}: {
  author: Author | null;
  size?: number;
}) {
  const dimension = `${size}px`;

  if (author?.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={author.avatar}
        alt={author.name}
        width={size}
        height={size}
        style={{
          width: dimension,
          height: dimension,
          borderRadius: "9999px",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: dimension,
        height: dimension,
        borderRadius: "9999px",
        background: "#1e293b",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(10, Math.round(size * 0.4)),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {author ? initials(author.name) : "?"}
    </div>
  );
}
