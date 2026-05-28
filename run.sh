#!/usr/bin/env bash
# run.sh — top-level lanes dispatcher. Routes subcommands to their docker/* handler,
# falling back to run-auto.sh for free-text cycle requests (legacy entry point).
#
# Usage:
#   ./run.sh init [dir]                  scaffold .lanes/ in dir (or $PWD)
#   ./run.sh run <item-id> [dir]         start a cycle against backlog item
#   ./run.sh web [--port N]              start the local read-only web
#   ./run.sh "<free-text request>" [dir] legacy: drive a cycle from free text
#
# Run ./setup.sh once first.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  init)
    shift
    exec "$SCRIPT_DIR/sdk/docker/lanes-init.sh" "$@"
    ;;
  run)
    shift
    exec "$SCRIPT_DIR/sdk/docker/lanes-run-item.sh" "$@"
    ;;
  web)
    shift
    exec "$SCRIPT_DIR/sdk/docker/lanes-web.sh" "$@"
    ;;
  *)
    exec "$SCRIPT_DIR/sdk/docker/run-auto.sh" "$@"
    ;;
esac
