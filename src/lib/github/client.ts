/**
 * Low-level GitHub API client. Everything the storage interface needs to
 * read and write single files lives here — callers should never talk to
 * the GitHub API directly (see CLAUDE.md, decision #2).
 *
 * Single-file writes use the Contents API (read-SHA -> PUT), which is
 * atomic and simpler than the blob/tree/commit dance. The batch script
 * (scripts/github_batch.py) is for genuinely multi-file operations like
 * scaffolding — most admin actions (save one post, upload one image) are
 * naturally single-file commits already.
 *
 * Server-side only. Never import this from a client component.
 */

const GITHUB_API = "https://api.github.com";

/**
 * Resolves a GitHub token for a given repo. Checks for a per-repo token
 * first (e.g. GITHUB_TOKEN_VELOCITY_B), falling back to a general
 * GITHUB_TOKEN. This lets sites be split onto their own fine-grained PATs
 * later (per CLAUDE.md's "GitHub access" section) without any code changes
 * — just add the env var.
 */
function resolveToken(repo: string): string {
  const envKey = `GITHUB_TOKEN_${repo
    .split("/")[1]
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")}`;
  const token = process.env[envKey] || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      `No GitHub token found for repo ${repo}. Set ${envKey} or GITHUB_TOKEN.`
    );
  }
  return token;
}

async function githubRequest(
  repo: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = resolveToken(repo);
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return res;
}

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
}

export class GitHubNotFoundError extends Error {}
export class GitHubConflictError extends Error {}

/**
 * Reads a single file's content and current SHA. Throws GitHubNotFoundError
 * if the file doesn't exist.
 */
export async function getFile(
  repo: string,
  branch: string,
  filePath: string
): Promise<GitHubFile> {
  const res = await githubRequest(
    repo,
    `/repos/${repo}/contents/${filePath}?ref=${branch}`
  );
  if (res.status === 404) {
    throw new GitHubNotFoundError(`${filePath} not found in ${repo}@${branch}`);
  }
  if (!res.ok) {
    throw new Error(`GitHub error ${res.status} reading ${filePath}: ${await res.text()}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) {
    throw new Error(`${filePath} is a directory, not a file`);
  }
  return {
    path: filePath,
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

/**
 * Lists files in a directory (non-recursive). Returns an empty array if the
 * directory doesn't exist rather than throwing, since "no posts yet" is a
 * normal state for a newly onboarded site.
 */
export async function listDir(
  repo: string,
  branch: string,
  dirPath: string
): Promise<{ name: string; path: string }[]> {
  const res = await githubRequest(
    repo,
    `/repos/${repo}/contents/${dirPath}?ref=${branch}`
  );
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`GitHub error ${res.status} listing ${dirPath}: ${await res.text()}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`${dirPath} is a file, not a directory`);
  }
  return data
    .filter((entry: { type: string }) => entry.type === "file")
    .map((entry: { name: string; path: string }) => ({
      name: entry.name,
      path: entry.path,
    }));
}

/**
 * Writes (creates or updates) a single file. Always re-fetches the current
 * SHA immediately before writing, per CLAUDE.md's "re-fetch SHA before
 * every write" discipline — minimizes the window for a stale-SHA 409.
 * Pass isBinary for images/media so content is base64-encoded rather than
 * treated as UTF-8 text.
 */
export async function putFile(
  repo: string,
  branch: string,
  filePath: string,
  content: string | Buffer,
  message: string,
  options: { isBinary?: boolean } = {}
): Promise<{ sha: string }> {
  let currentSha: string | undefined;
  try {
    const existing = await getFile(repo, branch, filePath);
    currentSha = existing.sha;
  } catch (err) {
    if (!(err instanceof GitHubNotFoundError)) throw err;
    // File doesn't exist yet — creating, not updating. No SHA needed.
  }

  const encodedContent = options.isBinary
    ? (content as Buffer).toString("base64")
    : Buffer.from(content as string, "utf-8").toString("base64");

  const res = await githubRequest(repo, `/repos/${repo}/contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: encodedContent,
      branch,
      ...(currentSha ? { sha: currentSha } : {}),
    }),
  });

  if (res.status === 409) {
    throw new GitHubConflictError(
      `Stale SHA writing ${filePath} — someone else committed in between. Retry.`
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub error ${res.status} writing ${filePath}: ${await res.text()}`);
  }
  const data = await res.json();
  return { sha: data.content.sha };
}

/**
 * Deletes a single file. Re-fetches SHA immediately before deleting, same
 * discipline as putFile.
 */
export async function deleteFile(
  repo: string,
  branch: string,
  filePath: string,
  message: string
): Promise<void> {
  const existing = await getFile(repo, branch, filePath);
  const res = await githubRequest(repo, `/repos/${repo}/contents/${filePath}`, {
    method: "DELETE",
    body: JSON.stringify({ message, sha: existing.sha, branch }),
  });
  if (res.status === 409) {
    throw new GitHubConflictError(
      `Stale SHA deleting ${filePath} — someone else committed in between. Retry.`
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub error ${res.status} deleting ${filePath}: ${await res.text()}`);
  }
}
