#!/usr/bin/env bash
# run.sh — run a lanes auto cycle (SDK + Docker).
# Usage: ./run.sh "<free-text request>" [worktree-dir]
# Thin forwarder to sdk/docker/run-auto.sh. Run ./setup.sh once first.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sdk/docker/run-auto.sh" "$@"
