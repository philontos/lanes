#!/usr/bin/env bash
# setup.sh — one-time setup for the lanes SDK orchestrator.
#
# Run this once before using run-auto.sh.
# It will:
#   1. Verify Docker is available (and start Docker Desktop if it isn't).
#   2. Verify claude CLI is on PATH.
#   3. Run 'claude setup-token' for you, auto-capture the token it prints
#      (falling back to manual paste), and save it to ~/.config/lanes/oauth-token.
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
  echo "Docker daemon not running — starting Docker Desktop for you..."
  open -a Docker 2>/dev/null || true

  # Wait up to ~90s for the daemon to come up, showing progress.
  for _ in $(seq 1 45); do
    if docker version &> /dev/null; then
      break
    fi
    printf '.'
    sleep 2
  done
  echo ""

  if ! docker version &> /dev/null; then
    echo ""
    echo "ERROR: Docker daemon still not ready after waiting ~90s."
    echo ""
    echo "Open Docker Desktop manually, wait for it to finish starting, then re-run this script."
    echo ""
    exit 1
  fi
  echo "✓ Docker Desktop started."
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
  echo "✓ Token already configured ($TOKEN_FILE). Delete it to redo."
  echo ""
else
  echo ""
  echo "No token found — setting one up for you now."
  echo "Running 'claude setup-token' (needs a Pro/Max subscription)."
  echo "A browser will open: approve the login there, then come back here."
  echo ""

  TOKEN=""
  CAPTURE="$(mktemp)"

  # Run setup-token under a pseudo-tty (via `script`) so you still see and can
  # interact with the login flow, while we capture the token it prints. We then
  # extract it automatically so there is nothing to copy-paste. `grep -ao` pulls
  # only the token chars, so surrounding terminal control bytes don't matter.
  if command -v script &> /dev/null; then
    script -q "$CAPTURE" claude setup-token || true
    TOKEN="$(LC_ALL=C grep -aoE 'sk-ant-oat[0-9]+-[A-Za-z0-9_-]+' "$CAPTURE" | tail -n1 || true)"
  else
    # No `script` available: run directly so you can still complete the flow.
    claude setup-token || true
  fi
  rm -f "$CAPTURE"

  if [[ -n "$TOKEN" ]]; then
    echo ""
    echo "✓ Captured the token automatically."
  else
    echo ""
    echo "Couldn't auto-detect the token from the output above."
    echo "Copy the token printed by 'claude setup-token' and paste it here."
    read -rsp "Paste the token: " TOKEN
    echo ""
  fi

  if [[ -z "$TOKEN" ]]; then
    echo ""
    echo "ERROR: No token captured or entered. Re-run setup.sh to try again."
    echo ""
    exit 1
  fi

  TOKEN_DIR="$(dirname "$TOKEN_FILE")"
  mkdir -p "$TOKEN_DIR"
  printf '%s' "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"

  echo ""
  echo "✓ Saved to $TOKEN_FILE (keep this secret; stored outside the repo)."
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
