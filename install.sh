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
#
# Severity:
#   [hard]      harness cannot run any cycle without this
#   [hard:ship] required only by the ship phase; earlier phases run fine
#   [soft]      improves UX; Claude can fall back if absent
# ---------------------------------------------------------------------------

echo
echo "Checking dependencies..."

issues=0

report() {
  local status="$1" name="$2" severity="$3" hint="$4"
  printf "  %-4s %-22s %s\n" "$status" "$name $severity" "$hint"
}

# --- hard: git ---
if command -v git >/dev/null 2>&1; then
  report "OK" "git" "[hard]" ""
else
  report "MISS" "git" "[hard]" "install via your OS package manager"
  issues=$((issues + 1))
fi

# --- hard: superpowers plugin (every skill in skills.json comes from here) ---
if compgen -G "$HOME/.claude/plugins/cache"/*/superpowers/*/skills/ > /dev/null 2>&1; then
  report "OK" "superpowers plugin" "[hard]" ""
else
  report "MISS" "superpowers plugin" "[hard]" "install via Claude Code's plugin manager"
  echo "       skills.json declares these skill names:"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.skills | to_entries[] | "         - \(.value)  (role: \(.key))"' \
       "$REPO_DIR/commands/harness/skills.json" 2>/dev/null || true
  else
    echo "         (install jq to see the list, or open commands/harness/skills.json)"
  fi
  echo "       Or edit skills.json to point at skills you do have."
  issues=$((issues + 1))
fi

# --- hard:ship: at least one of gh or glab ---
gh_present=0; glab_present=0
command -v gh   >/dev/null 2>&1 && gh_present=1
command -v glab >/dev/null 2>&1 && glab_present=1
if [ "$gh_present" -eq 1 ] && [ "$glab_present" -eq 1 ]; then
  report "OK" "gh + glab" "[hard:ship]" "both present — GitHub and GitLab ship covered"
elif [ "$gh_present" -eq 1 ]; then
  report "OK" "gh" "[hard:ship]" "GitHub remotes covered; install glab for GitLab"
elif [ "$glab_present" -eq 1 ]; then
  report "OK" "glab" "[hard:ship]" "GitLab remotes covered; install gh for GitHub"
else
  report "MISS" "gh / glab" "[hard:ship]" "install at least one before running ship phase"
  echo "       gh   (GitHub):  brew install gh   && gh auth login"
  echo "       glab (GitLab):  brew install glab && glab auth login"
  echo "       Without either, ship will push the branch but won't auto-open a PR/MR."
  issues=$((issues + 1))
fi

# --- soft: jq ---
if command -v jq >/dev/null 2>&1; then
  report "OK" "jq" "[soft]" "speeds up state.json reads"
else
  report "MISS" "jq" "[soft]" "Claude will fall back to the Read tool; install for cleaner runs"
fi

echo
if [ "$issues" -eq 0 ]; then
  echo "All hard dependencies present. You're ready to /harness."
else
  echo "$issues hard dependency(ies) missing. harness is installed but /harness"
  echo "will fail at runtime until you address [hard] items above."
  echo "[soft] items are advisory; [hard:ship] items only matter at the ship phase."
fi
