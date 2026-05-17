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
