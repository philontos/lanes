#!/usr/bin/env bash
# Install harness commands into ~/.claude/commands/.
#
# Modes:
#   symlink (default) — link files to this repo; 'git pull' updates take effect immediately.
#   copy              — copy files into ~/.claude; re-run after 'git pull' to update.
#
# Either mode backs up any existing non-empty target as <name>.bak.<timestamp>.

set -euo pipefail

MODE="symlink"

usage() {
  cat <<EOF
Usage: ./install.sh [--mode=symlink|copy] [-h|--help]

  --mode=symlink   (default) Symlink ~/.claude/commands/{harness.md,harness}
                   to this repo. Updates to the repo propagate automatically.
  --mode=copy      Copy files into ~/.claude/commands/. To pick up upstream
                   changes after 'git pull', re-run this script.
  -h, --help       Show this help.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode=symlink|--symlink) MODE="symlink"; shift ;;
    --mode=copy|--copy)       MODE="copy";    shift ;;
    --mode=*)                 echo "Unknown mode: ${1#--mode=}" >&2; usage; exit 1 ;;
    -h|--help)                usage; exit 0 ;;
    *)                        echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_CMD="$HOME/.claude/commands"
mkdir -p "$CLAUDE_CMD"
TS="$(date +%Y%m%d-%H%M%S)"

backup_if_present() {
  local target="$1"
  if [ -L "$target" ] || [ -e "$target" ]; then
    mv "$target" "$target.bak.$TS"
    echo "  backed up: $target -> $target.bak.$TS"
  fi
}

echo "Installing harness commands to $CLAUDE_CMD (mode: $MODE)"

backup_if_present "$CLAUDE_CMD/harness.md"
backup_if_present "$CLAUDE_CMD/harness"

if [ "$MODE" = "symlink" ]; then
  ln -s "$REPO_DIR/commands/harness.md" "$CLAUDE_CMD/harness.md"
  ln -s "$REPO_DIR/commands/harness"    "$CLAUDE_CMD/harness"
  echo "  symlinked harness.md -> $REPO_DIR/commands/harness.md"
  echo "  symlinked harness/   -> $REPO_DIR/commands/harness/"
  echo
  echo "Done. After 'git pull' the new content is picked up automatically."
else
  cp "$REPO_DIR/commands/harness.md" "$CLAUDE_CMD/harness.md"
  cp -R "$REPO_DIR/commands/harness" "$CLAUDE_CMD/harness"
  echo "  copied harness.md"
  echo "  copied harness/ (recursive)"
  echo
  echo "Done. To pick up upstream changes later:"
  echo "  cd $REPO_DIR && git pull && ./install.sh --mode=copy"
fi

# ---------------------------------------------------------------------------
# Dependency self-check (advisory only — does not exit non-zero).
# Lets users install harness first and dependencies after if they prefer.
# ---------------------------------------------------------------------------

echo
echo "Checking dependencies..."

missing=0

# CLI tools used by phase commands and ship
for cmd in jq gh git; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  OK   $cmd"
  else
    echo "  MISS $cmd  (install via your package manager — required at runtime)"
    missing=$((missing + 1))
  fi
done

# superpowers plugin — providers of every skill named in skills.json
if compgen -G "$HOME/.claude/plugins/cache"/*/superpowers/*/skills/ > /dev/null 2>&1; then
  echo "  OK   superpowers plugin"
else
  echo "  MISS superpowers plugin"
  echo "       harness phase commands look up these skill names in commands/harness/skills.json:"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.skills | to_entries[] | "         - \(.value)  (logical role: \(.key))"' \
       "$REPO_DIR/commands/harness/skills.json" 2>/dev/null || true
  else
    echo "         (install jq to see the skill list, or open commands/harness/skills.json)"
  fi
  echo "       Install via Claude Code's plugin manager, or edit skills.json to map"
  echo "       logical roles to skills you do have."
  missing=$((missing + 1))
fi

echo
if [ "$missing" -eq 0 ]; then
  echo "All dependencies present. You're ready to /harness."
else
  echo "$missing dependency(ies) missing. harness is installed but /harness will fail"
  echo "at runtime until you address the items above."
fi
