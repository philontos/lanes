#!/usr/bin/env bash
# run.sh — top-level lanes dispatcher. Routes subcommands to their docker/* handler,
# falling back to run-auto.sh for free-text cycle requests (legacy entry point).
#
# Usage:
#   ./run.sh web [--port N]              start the local web on :7777 (primary entry)
#   ./run.sh "<free-text request>" [dir] legacy: drive a forge cycle from free text
#
# Project bootstrap (init lane) and iteration (reshape lane) go via the web
# only. The legacy free-text entry stays for CI / scripted use.
#
# Run ./setup.sh once first.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  web)
    shift
    exec "$SCRIPT_DIR/docker/lanes-web.sh" "$@"
    ;;
  *)
    exec "$SCRIPT_DIR/docker/run-auto.sh" "$@"
    ;;
esac
