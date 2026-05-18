#!/usr/bin/env bash
# Remove lanes commands (forge + compass + shared PROTOCOL) from ~/.claude/commands/.
#
# Symlinks are removed unconditionally.
# Regular files/directories (copy-mode installs) are NOT touched — they are
# reported with a warning so the user can decide.
#
# Any prior .bak.<timestamp> snapshots from install.sh are left in place.

set -euo pipefail

CLAUDE_CMD="$HOME/.claude/commands"

TARGETS=(
  "PROTOCOL.md"
  "forge.md"
  "forge"
  "compass.md"
  "compass"
)

remove_target() {
  local target="$1"
  if [ -L "$target" ]; then
    rm "$target"
    echo "  removed symlink: $target"
  elif [ -e "$target" ]; then
    echo "  WARNING: $target is not a symlink (probably installed in --mode=copy)."
    echo "           Remove manually if intended:  rm -rf '$target'"
  else
    echo "  not present: $target"
  fi
}

echo "Removing lanes commands from $CLAUDE_CMD"
for t in "${TARGETS[@]}"; do
  remove_target "$CLAUDE_CMD/$t"
done
echo
echo "Any *.bak.<timestamp> snapshots in $CLAUDE_CMD are preserved."
echo "Done."
