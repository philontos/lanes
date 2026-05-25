#!/usr/bin/env bash
# setup.sh — one-time setup for the lanes SDK orchestrator.
#
# Run this once before using run-auto.sh.
# It will:
#   1. Verify Docker is available.
#   2. Verify claude CLI is on PATH.
#   3. Prompt for your OAuth token and save it to ~/.config/lanes/oauth-token.
#   4. Build the Docker image.
#
# After this, run:
#   ./sdk/docker/run-auto.sh "your request"

set -euo pipefail

# Resolve script and repo dirs so this works regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 1. Docker ────────────────────────────────────────────────────────────────
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

if ! command -v docker &> /dev/null; then
  echo ""
  echo "ERROR: 'docker' not found on PATH even after prepending Docker.app/Contents/Resources/bin."
  echo ""
  echo "Please install Docker Desktop for Mac from https://www.docker.com/products/docker-desktop/"
  echo "and make sure Docker Desktop is running before re-running this script."
  echo ""
  exit 1
fi

if ! docker version &> /dev/null; then
  echo ""
  echo "ERROR: 'docker version' failed — Docker daemon may not be running."
  echo ""
  echo "Open Docker Desktop and wait for it to finish starting, then re-run this script."
  echo ""
  exit 1
fi

echo "✓ Docker is available."

# ── 2. claude CLI ────────────────────────────────────────────────────────────
if ! command -v claude &> /dev/null; then
  echo ""
  echo "ERROR: 'claude' CLI not found on PATH."
  echo ""
  echo "Install Claude Code and log in:"
  echo "  npm install -g @anthropic-ai/claude-code"
  echo "  claude login"
  echo ""
  echo "Then re-run this script."
  echo ""
  exit 1
fi

echo "✓ claude CLI is available."

# ── 3. Token ─────────────────────────────────────────────────────────────────
TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/lanes/oauth-token"

if [[ -s "$TOKEN_FILE" ]]; then
  echo ""
  echo "Token already configured (delete $TOKEN_FILE to redo)."
  echo ""
else
  echo ""
  echo "Run 'claude setup-token' (a browser will open; needs Pro/Max subscription)."
  echo "Copy the token it prints."
  echo ""
  read -rsp "Paste the token here: " TOKEN
  echo ""

  if [[ -z "$TOKEN" ]]; then
    echo ""
    echo "ERROR: No token entered. Re-run setup.sh and paste your token when prompted."
    echo ""
    exit 1
  fi

  TOKEN_DIR="$(dirname "$TOKEN_FILE")"
  mkdir -p "$TOKEN_DIR"
  printf '%s' "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"

  echo ""
  echo "Saved to $TOKEN_FILE (keep this secret; it is stored outside the repo)."
  echo ""
fi

# ── 4. Build image ───────────────────────────────────────────────────────────
echo "Building Docker image 'lanes-sdk-orchestrator:latest'..."
echo ""

docker build -t lanes-sdk-orchestrator:latest -f "$SCRIPT_DIR/Dockerfile" "$SDK_DIR"

echo ""
echo "Done. Next:"
echo ""
echo "  ./sdk/docker/run-auto.sh \"<your request>\""
echo ""
echo "Example:"
echo "  ./sdk/docker/run-auto.sh \"add a /healthz endpoint returning 200 OK\""
echo ""
