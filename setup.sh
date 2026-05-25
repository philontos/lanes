#!/usr/bin/env bash
# setup.sh — one-time setup for lanes auto mode (SDK + Docker).
# Thin forwarder to sdk/docker/setup.sh; run this once before ./run.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sdk/docker/setup.sh" "$@"
