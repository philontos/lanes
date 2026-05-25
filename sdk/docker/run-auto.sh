#!/usr/bin/env bash
# run-auto.sh — one-command runner for the lanes SDK orchestrator.
#
# Usage:
#   ./sdk/docker/run-auto.sh "<free-text request>" [worktree-dir]
#
# Prerequisites:
#   Run ./sdk/docker/setup.sh once first.
#
# If [worktree-dir] is omitted a temporary scratch cycle directory is created.
# Note: scratch mode is for trying things out — real project integration and
# proper git worktrees come with the full forge loop later.
#
# Example:
#   ./sdk/docker/run-auto.sh "add a /healthz endpoint returning 200 OK"
#   ./sdk/docker/run-auto.sh "refactor auth module" ~/worktrees/my-feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Help ─────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  grep '^#' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# ── Args ─────────────────────────────────────────────────────────────────────
REQUEST="${1:-}"
if [[ -z "$REQUEST" ]]; then
  echo ""
  echo "ERROR: request argument is required."
  echo ""
  echo "Usage: $0 \"<free-text request>\" [worktree-dir]"
  echo "Example: $0 \"add a /healthz endpoint returning 200 OK\""
  echo ""
  exit 1
fi

# ── Worktree dir ─────────────────────────────────────────────────────────────
if [[ -n "${2:-}" ]]; then
  WT="$(cd "$2" && pwd)"
else
  # Scratch mode: create a temporary cycle directory.
  # Note: scratch mode is for trying it out — real project integration /
  # proper git worktrees come with the full forge loop later.
  WT="$(mktemp -d)/cycle"
  mkdir -p "$WT/.lane"
  echo "(scratch mode) Created temporary worktree: $WT"
fi

mkdir -p "$WT/.lane"

# ── AGENTS.md ─────────────────────────────────────────────────────────────────
# Only seed a placeholder in scratch mode (no worktree arg). Never fabricate an
# AGENTS.md inside a real project dir — if absent, the agent proceeds with none.
if [[ -z "${2:-}" && ! -f "$WT/AGENTS.md" ]]; then
  cat > "$WT/AGENTS.md" <<'EOF'
project rules: keep it tiny.
EOF
fi

# ── state.json — JSON-escape the request via python3 ─────────────────────────
# Using python3 json.dumps ensures quotes, backslashes, newlines, etc. are
# correctly escaped — never do naive shell interpolation into JSON.
ESCAPED_REQUEST="$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$REQUEST")"

CYCLE_ID="cycle-$(date +%Y%m%d-%H%M%S)"

cat > "$WT/.lane/state.json" <<EOF
{
  "lane": "forge",
  "cycle_id": "$CYCLE_ID",
  "phase": "spec",
  "status": "ok",
  "autonomy": "auto",
  "request": $ESCAPED_REQUEST
}
EOF

echo "Wrote $WT/.lane/state.json"
echo "  lane: forge | phase: spec | autonomy: auto"
echo "  request: $REQUEST"
echo ""

# ── Launch ────────────────────────────────────────────────────────────────────
"$SCRIPT_DIR/lanes-docker.sh" "$WT" forge spec

# ── Print outputs ─────────────────────────────────────────────────────────────
echo ""
echo "=== spec.md ==="
if [[ -f "$WT/.lane/spec.md" ]]; then
  cat "$WT/.lane/spec.md"
else
  echo "(not found)"
fi

echo ""
echo "=== decision-log.md ==="
if [[ -f "$WT/.lane/decision-log.md" ]]; then
  cat "$WT/.lane/decision-log.md"
else
  echo "(not present)"
fi

if [[ -f "$WT/.lane/denied-tools.log" ]]; then
  echo ""
  echo "=== denied-tools.log ==="
  cat "$WT/.lane/denied-tools.log"
fi

echo ""
echo "Worktree: $WT"
