// Public test blog post detail — see CLAUDE.md "Velocity B blog front-end
// migration" and the tracking task (tm-1786121459881) for full scope.
//
// Currently an empty scaffold: routing structure only, not yet wired to
// getPost() or real content.

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>{slug}</h1>
      <p>Post content not wired up yet.</p>
    </main>
  );
}
