// Public test blog index — see CLAUDE.md "Velocity B blog front-end
// migration" and the tracking task (tm-1786121459881) for full scope.
//
// Deliberately public (not behind the admin's auth gate, once that
// exists) and unlinked from mediasurface's own nav.
//
// Currently an empty scaffold: routing structure only, not yet wired to
// real content via the storage interface. Next step is wiring listPosts
// here, then draft-filtering/author/OG logic on top of that.

export default function BlogIndexPage() {
  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>Blog</h1>
      <p>No posts wired up yet.</p>
    </main>
  );
}
