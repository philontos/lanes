#!/usr/bin/env bash
# lanes-init.sh — scaffold .lanes/ in a target git repo.
#
# Usage:
#   lanes init [dir]
#
# Writes the five-layer project state skeleton:
#   .lanes/summary.md       (TBD cover)
#   .lanes/spec.md          (six fixed H2 sections, each "(none yet)")
#   .lanes/features.json    ({ "next_id_seq": 1, "features": [] })
#   .lanes/plan.md          (TBD)
#   .lanes/backlog.json     ({ "next_id_seq": 1, "items": [] })
#
# Defaults dir to $PWD. Fails loud if .lanes/ already exists (never overwrite).
# Inits a git repo if dir is not one already — `lanes run` later needs git anyway,
# and the user can always `rm -rf .git` if this was unintended.
set -euo pipefail

TARGET="${1:-$PWD}"

if [[ ! -d "$TARGET" ]]; then
  echo "ERROR: target dir '$TARGET' does not exist." >&2
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
NAME="$(basename "$TARGET")"

if [[ -d "$TARGET/.lanes" ]]; then
  echo "ERROR: $TARGET/.lanes already exists; refusing to overwrite." >&2
  echo "  Delete it first if you really want to re-scaffold." >&2
  exit 1
fi

# Init git if needed — `lanes run` later commits .lanes/ updates on a branch.
if ! git -C "$TARGET" rev-parse --git-dir > /dev/null 2>&1; then
  git -C "$TARGET" init -q
  echo "Initialised empty git repo in $TARGET"
fi

mkdir -p "$TARGET/.lanes"

cat > "$TARGET/.lanes/summary.md" <<EOF
# $NAME

(TBD — one paragraph: what this project is and what problem it solves.)
EOF

cat > "$TARGET/.lanes/spec.md" <<'EOF'
## Goal
(none yet — write 1–3 paragraphs of product intent: who, what experience, why now.)

## Scope IN
- (none yet)

## Scope OUT
- (none yet)

## Success Criteria
- (none yet)

## Open Questions
(none yet)

## Constraints
(none yet)
EOF

printf '{\n  "next_id_seq": 1,\n  "features": []\n}\n' > "$TARGET/.lanes/features.json"

cat > "$TARGET/.lanes/plan.md" <<'EOF'
# Tech Plan

(TBD — short global technical foundation: stack, architecture, cross-feature key decisions.
Per-feature implementation details live in each feature's `design_notes` field in features.json.)
EOF

printf '{\n  "next_id_seq": 1,\n  "items": []\n}\n' > "$TARGET/.lanes/backlog.json"

echo "Scaffolded $TARGET/.lanes/:"
echo "  summary.md       L0 cover"
echo "  spec.md          L1 WHAT & WHY (6 fixed sections)"
echo "  features.json    L2 capabilities (empty)"
echo "  plan.md          L3 global tech foundation"
echo "  backlog.json     L4 executable items (empty)"
echo ""
echo "Next: edit .lanes/ files, then start a cycle with"
echo "  lanes run <item-id>"
