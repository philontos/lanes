#!/usr/bin/env bash
# Remove harness commands from ~/.claude/commands/.
#
# Symlinks are removed unconditionally.
# Regular files/directories (copy-mode installs) are NOT touched — they are
# reported with a warning so the user can decide.
#
# Any prior .bak.<timestamp> snapshots from install.sh are left in place.

set -euo pipefail

CLAUDE_CMD="$HOME/.claude/commands"

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

echo "Removing harness commands from $CLAUDE_CMD"
remove_target "$CLAUDE_CMD/harness.md"
remove_target "$CLAUDE_CMD/harness"
echo
echo "Any *.bak.<timestamp> snapshots in $CLAUDE_CMD are preserved."
echo "Done."
