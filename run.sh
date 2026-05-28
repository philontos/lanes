#!/usr/bin/env bash
# run.sh — top-level lanes dispatcher. Routes subcommands to their docker/* handler,
# falling back to run-auto.sh for free-text cycle requests (legacy entry point).
#
# Usage:
#   ./run.sh init [dir]                  scaffold .lanes/ in dir (or $PWD)
#   ./run.sh web [--port N]              start the local web on :7777
#   ./run.sh "<free-text request>" [dir] legacy: drive a cycle from free text
#
# All user-level cycle triggering goes via the web (lanes web); the legacy
# free-text entry stays for CI / scripted use.
#
# Run ./setup.sh once first.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  init)
    shift
    exec "$SCRIPT_DIR/docker/lanes-init.sh" "$@"
    ;;
  web)
    shift
    exec "$SCRIPT_DIR/docker/lanes-web.sh" "$@"
    ;;
  *)
    exec "$SCRIPT_DIR/docker/run-auto.sh" "$@"
    ;;
esac
