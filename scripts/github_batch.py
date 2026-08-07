#!/usr/bin/env python3
"""
github_batch.py — batch-commit a directory tree to a GitHub repo in a single
commit, using the Git Data API (blob -> tree -> commit -> ref).

Why this exists: writing files one at a time via the Contents API creates one
commit per file. This script stages everything as blobs, builds a single tree
on top of the current commit, and moves the branch ref forward once. This is
the standard practice for this project (see CLAUDE.md) — always batch, never
one-file-per-commit.

No secrets live in this file. The token is read from the GITHUB_TOKEN
environment variable (or a --token-file pointing at a local credentials file)
at runtime.

Usage:
    export GITHUB_TOKEN=ghp_xxx
    python3 scripts/github_batch.py \
        --repo vb-iant/mediasurface \
        --branch main \
        --local-dir . \
        --message "Initial Next.js scaffold" \
        --include-ext .ts,.tsx,.js,.jsx,.json,.css,.md,.mjs \
        --exclude-dir node_modules,.next,.git

Notes:
- Always re-fetches the branch's current SHA immediately before building the
  commit, to minimize the window for a stale-SHA 409 conflict.
- Text files are committed as UTF-8 blobs; binary files (images etc.) are
  base64-encoded blobs.
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
import urllib.error


API = "https://api.github.com"


def gh_request(method, path, token, body=None):
    url = f"{API}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        print(f"GitHub API error {e.code} on {method} {path}:\n{err_body}", file=sys.stderr)
        raise


def collect_files(local_dir, include_ext, exclude_dirs):
    files = []
    for root, dirs, filenames in os.walk(local_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for fname in filenames:
            if include_ext and not any(fname.endswith(ext) for ext in include_ext):
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, local_dir)
            files.append((full_path, rel_path.replace(os.sep, "/")))
    return files


def create_blob(token, owner_repo, full_path):
    with open(full_path, "rb") as f:
        raw = f.read()
    try:
        content = raw.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        content = base64.b64encode(raw).decode("ascii")
        encoding = "base64"
    result = gh_request(
        "POST",
        f"/repos/{owner_repo}/git/blobs",
        token,
        {"content": content, "encoding": encoding},
    )
    return result["sha"]


def main():
    parser = argparse.ArgumentParser(description="Batch-commit a directory to GitHub in one commit.")
    parser.add_argument("--repo", required=True, help="owner/repo, e.g. vb-iant/mediasurface")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--local-dir", default=".")
    parser.add_argument("--message", required=True)
    parser.add_argument("--include-ext", default="", help="Comma-separated list of extensions to include; empty = all files")
    parser.add_argument("--exclude-dir", default="node_modules,.next,.git", help="Comma-separated directory names to skip")
    parser.add_argument("--token-file", default=None, help="Optional path to a file containing the token, instead of GITHUB_TOKEN env var")
    args = parser.parse_args()

    if args.token_file:
        with open(args.token_file) as f:
            token = f.read().strip()
    else:
        token = os.environ.get("GITHUB_TOKEN")

    if not token:
        print("No token found. Set GITHUB_TOKEN or pass --token-file.", file=sys.stderr)
        sys.exit(1)

    include_ext = tuple(e.strip() for e in args.include_ext.split(",") if e.strip())
    exclude_dirs = set(d.strip() for d in args.exclude_dir.split(",") if d.strip())

    files = collect_files(args.local_dir, include_ext, exclude_dirs)
    if not files:
        print("No files matched — nothing to commit.", file=sys.stderr)
        sys.exit(1)

    print(f"Staging {len(files)} files for {args.repo}@{args.branch} ...")

    # Re-fetch current ref/commit/tree SHA immediately before building the commit.
    # Handle the empty-repo case (no commits, no ref yet) separately.
    base_commit_sha = None
    base_tree_sha = None
    ref_exists = True
    try:
        ref = gh_request("GET", f"/repos/{args.repo}/git/refs/heads/{args.branch}", token)
        base_commit_sha = ref["object"]["sha"]
        base_commit = gh_request("GET", f"/repos/{args.repo}/git/commits/{base_commit_sha}", token)
        base_tree_sha = base_commit["tree"]["sha"]
    except urllib.error.HTTPError:
        ref_exists = False
        print("No existing branch/commits found — creating the first commit.")

    tree_entries = []
    for full_path, rel_path in files:
        blob_sha = create_blob(token, args.repo, full_path)
        tree_entries.append({
            "path": rel_path,
            "mode": "100644",
            "type": "blob",
            "sha": blob_sha,
        })

    tree_body = {"tree": tree_entries}
    if base_tree_sha:
        tree_body["base_tree"] = base_tree_sha
    new_tree = gh_request("POST", f"/repos/{args.repo}/git/trees", token, tree_body)

    commit_body = {"message": args.message, "tree": new_tree["sha"]}
    if base_commit_sha:
        commit_body["parents"] = [base_commit_sha]
    new_commit = gh_request("POST", f"/repos/{args.repo}/git/commits", token, commit_body)

    if ref_exists:
        gh_request(
            "PATCH",
            f"/repos/{args.repo}/git/refs/heads/{args.branch}",
            token,
            {"sha": new_commit["sha"], "force": False},
        )
    else:
        gh_request(
            "POST",
            f"/repos/{args.repo}/git/refs",
            token,
            {"ref": f"refs/heads/{args.branch}", "sha": new_commit["sha"]},
        )

    print(f"Committed {len(files)} files as {new_commit['sha']} on {args.branch}.")


if __name__ == "__main__":
    main()
