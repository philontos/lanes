#!/usr/bin/env bash
# lanes-docker.sh — one-click launcher for the lanes SDK orchestrator in a Linux container.
#
# Usage:
#   ./lanes-docker.sh <worktree-dir> [lane] [phase]
#
# Prerequisites:
#   1. Run `claude setup-token` on the host (macOS) to obtain a long-lived OAuth token.
#   2. Export it:  export CLAUDE_CODE_OAUTH_TOKEN=<token>
#   3. Then: ./lanes-docker.sh /path/to/your/worktree [forge] [spec]
#
# The container mounts (read-only unless noted):
#   ~/Develop/personal/lanes                 → /root/Develop/personal/lanes
#     (for lanes.config.json, principles.md, and the full lanes repo)
#   <worktree-dir>                           → /worktree  (read-write)
# (superpowers skills are baked into the image, not mounted from the host.)

set -euo pipefail

# ── Source token from file if not already in env ─────────────────────────────
# setup.sh saves the token to ${XDG_CONFIG_HOME:-$HOME/.config}/lanes/oauth-token.
# Read it into the env var so the user never needs to manually export it.
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  _TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/lanes/oauth-token"
  if [[ -s "$_TOKEN_FILE" ]]; then
    CLAUDE_CODE_OAUTH_TOKEN="$(cat "$_TOKEN_FILE")"
    export CLAUDE_CODE_OAUTH_TOKEN
  fi
  unset _TOKEN_FILE
fi

# ── Validate token ──────────────────────────────────────────────────────────
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo ""
  echo "ERROR: CLAUDE_CODE_OAUTH_TOKEN is not set."
  echo ""
  echo "To obtain a token:"
  echo "  1. On macOS, run:  claude setup-token"
  echo "  2. Then export it: export CLAUDE_CODE_OAUTH_TOKEN=<the-token>"
  echo "  3. Re-run this script."
  echo ""
  exit 1
fi

# ── Args ─────────────────────────────────────────────────────────────────────
WORKTREE_DIR="${1:-}"
LANE="${2:-forge}"
PHASE="${3:-spec}"

if [[ -z "$WORKTREE_DIR" ]]; then
  echo "Usage: $0 <worktree-dir> [lane] [phase]"
  echo "Example: $0 /path/to/my-feature forge spec"
  exit 1
fi

# Resolve to absolute path
WORKTREE_DIR="$(cd "$WORKTREE_DIR" && pwd)"

# ── Ensure the worktree is a git repo ─────────────────────────────────────────
# The impl phase's skills (executing-plans / TDD) checkpoint progress with
# per-step git commits, so the dir we mount read-write must be a repo. If it is
# not one already (a fresh scratch dir or an empty project folder), initialise it
# now — guarded so an existing repo (or a subdir of one) is left untouched.
if command -v git > /dev/null 2>&1; then
  if ! git -C "$WORKTREE_DIR" rev-parse --git-dir > /dev/null 2>&1; then
    git -C "$WORKTREE_DIR" init -q
    echo "Initialised empty git repo in $WORKTREE_DIR"
  fi
else
  echo "WARNING: git not found on host — skipping repo init; the impl phase's per-step commits may fail." >&2
fi

# ── Paths on host ────────────────────────────────────────────────────────────
HOST_LANES_REPO="$HOME/Develop/personal/lanes"

# Container HOME is /root (node:22-bookworm-slim default)
CONTAINER_HOME="/root"

# ── Image name ───────────────────────────────────────────────────────────────
IMAGE="${LANES_SDK_IMAGE:-lanes-sdk-orchestrator:latest}"

# ── Check image exists ───────────────────────────────────────────────────────
if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
  echo "Image '$IMAGE' not found. Building now..."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # Build context is sdk/ (parent of docker/)
  docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR/.."
fi

echo "Launching lanes orchestrator in Docker..."
echo "  Worktree : $WORKTREE_DIR"
echo "  Lane     : $LANE"
echo "  Phase    : $PHASE"
echo "  Image    : $IMAGE"
echo ""

export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

docker run --rm \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -v "${HOST_LANES_REPO}:${CONTAINER_HOME}/Develop/personal/lanes:ro" \
  -v "${WORKTREE_DIR}:/worktree:rw" \
  "$IMAGE" \
  --auto /worktree "$LANE" "$PHASE"
