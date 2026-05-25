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
#   ~/.claude/plugins                        → /root/.claude/plugins
#   ~/Develop/personal/lanes/commands        → /root/.claude/commands
#     (Note: ~/.claude/commands entries are symlinks into the lanes repo;
#      Docker doesn't follow cross-mount symlinks, so we mount the real source dir.)
#   ~/Develop/personal/lanes                 → /root/Develop/personal/lanes
#     (for principles.md and the full lanes repo)
#   <worktree-dir>                           → /worktree  (read-write)

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

# ── Paths on host ────────────────────────────────────────────────────────────
HOST_CLAUDE_PLUGINS="$HOME/.claude/plugins"
HOST_LANES_REPO="$HOME/Develop/personal/lanes"

# ~/.claude/commands entries are symlinks into the lanes repo.
# Docker bind-mount does NOT follow cross-mount symlinks, so we mount the
# actual source directory (lanes/commands/) rather than ~/.claude/commands.
HOST_LANES_COMMANDS="$HOME/Develop/personal/lanes/commands"

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
  -v "${HOST_CLAUDE_PLUGINS}:${CONTAINER_HOME}/.claude/plugins:ro" \
  -v "${HOST_LANES_COMMANDS}:${CONTAINER_HOME}/.claude/commands:ro" \
  -v "${HOST_LANES_REPO}:${CONTAINER_HOME}/Develop/personal/lanes:ro" \
  -v "${WORKTREE_DIR}:/worktree:rw" \
  "$IMAGE" \
  --auto /worktree "$LANE" "$PHASE"
