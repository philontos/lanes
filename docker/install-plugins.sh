#!/usr/bin/env bash
# install-plugins.sh — bake the plugins declared in a manifest into the image.
#
# Usage: install-plugins.sh <manifest.json> <dest-dir>
#
# Manifest: { "plugins": [ { "name", "repo", "ref"?, "subpath"? }, ... ] }
#   name    install dir under <dest-dir> (and the plugin's namespace)
#   repo    git URL to clone
#   ref     tag/branch to pin (reproducible builds); omit for default branch
#   subpath plugin's dir inside a multi-plugin marketplace repo (optional)
#
# Run at image build time so the runtime is fully self-contained (no host plugin
# dependency). The orchestrator loads <dest-dir>/* via $LANES_PLUGINS.
set -euo pipefail

MANIFEST="${1:?usage: install-plugins.sh <manifest.json> <dest-dir>}"
DEST="${2:?usage: install-plugins.sh <manifest.json> <dest-dir>}"
mkdir -p "$DEST"

# Parse with node (present in the base image) — no jq dependency.
count="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String((m.plugins||[]).length))' "$MANIFEST")"

for ((i = 0; i < count; i++)); do
  # Tab-separated, trailing newline so `read` (under set -e) gets a clean line and
  # empty fields (ref/subpath) survive splitting.
  IFS=$'\t' read -r name repo ref subpath < <(node -e '
    const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).plugins[+process.argv[2]];
    process.stdout.write([m.name||"",m.repo||"",m.ref||"",m.subpath||""].join("\t")+"\n");
  ' "$MANIFEST" "$i")

  if [[ -z "$name" || -z "$repo" || -z "$ref" ]]; then
    echo "install-plugins: entry $i ($name) needs name + repo + ref (pin a tag/branch/commit for reproducible builds)" >&2; exit 1
  fi
  echo "Installing plugin: $name @ $ref${subpath:+ ($subpath)}"

  # init + fetch + checkout works for a tag, a branch, OR a commit SHA (GitHub allows
  # fetching a reachable SHA) — `git clone --branch` can't take a raw commit, and some
  # marketplaces (e.g. the official one) publish no tags, so we must pin by SHA.
  tmp="$(mktemp -d)"
  git -C "$tmp" init -q repo
  git -C "$tmp/repo" remote add origin "$repo"
  if ! git -C "$tmp/repo" fetch --depth 1 -q origin "$ref"; then
    echo "install-plugins: $name — cannot fetch ref '$ref' from $repo" >&2; exit 1
  fi
  git -C "$tmp/repo" checkout -q FETCH_HEAD

  src="$tmp/repo"
  [[ -n "$subpath" ]] && src="$tmp/repo/$subpath"
  if [[ ! -d "$src" ]]; then
    echo "install-plugins: $name — path '$src' not found in repo" >&2; exit 1
  fi
  rm -rf "$DEST/$name"
  cp -R "$src" "$DEST/$name"
  rm -rf "$DEST/$name/.git" "$tmp"
done

echo "Installed $count plugin(s) into $DEST"
