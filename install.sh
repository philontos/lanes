#!/usr/bin/env bash
# Install lanes commands (forge + compass + shared PROTOCOL) into ~/.claude/commands/.
#
# Modes:
#   symlink (default) — link files to this repo; 'git pull' updates take effect immediately.
#   copy              — copy files into ~/.claude; re-run after 'git pull' to update.
#
# Either mode backs up any existing non-empty target as <name>.bak.<timestamp>.

set -euo pipefail

MODE="symlink"
CHECK_ONLY=0

usage() {
  cat <<EOF
Usage: ./install.sh [--mode=symlink|copy] [--check-only] [-h|--help]

  --mode=symlink   (default) Symlink ~/.claude/commands/{PROTOCOL.md,forge.md,forge,
                   compass.md,compass} to this repo. Updates to the repo propagate
                   automatically.
  --mode=copy      Copy files into ~/.claude/commands/. To pick up upstream changes
                   after 'git pull', re-run this script.
  --check-only     Skip the install step; just run the dependency self-check.
                   Use this after addressing a [hard] MISS to re-verify.
  -h, --help       Show this help.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode=symlink|--symlink) MODE="symlink"; shift ;;
    --mode=copy|--copy)       MODE="copy";    shift ;;
    --mode=*)                 echo "Unknown mode: ${1#--mode=}" >&2; usage; exit 1 ;;
    --check-only|--doctor)    CHECK_ONLY=1;   shift ;;
    -h|--help)                usage; exit 0 ;;
    *)                        echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_CMD="$HOME/.claude/commands"
mkdir -p "$CLAUDE_CMD"
TS="$(date +%Y%m%d-%H%M%S)"

# Targets to install (skip any that don't exist in the repo — e.g. compass before it's built).
TARGETS=(
  "PROTOCOL.md"   # shared
  "forge.md"
  "forge"
  "compass.md"
  "compass"
)

backup_if_present() {
  local target="$1"
  if [ -L "$target" ] || [ -e "$target" ]; then
    mv "$target" "$target.bak.$TS"
    echo "  backed up: $target -> $target.bak.$TS"
  fi
}

install_one() {
  local name="$1"
  local src="$REPO_DIR/commands/$name"
  local dst="$CLAUDE_CMD/$name"

  if [ ! -e "$src" ]; then
    echo "  skipped: $name (not present in repo)"
    return
  fi

  backup_if_present "$dst"

  if [ "$MODE" = "symlink" ]; then
    ln -s "$src" "$dst"
    echo "  symlinked $name -> $src"
  else
    if [ -d "$src" ]; then
      cp -R "$src" "$dst"
    else
      cp "$src" "$dst"
    fi
    echo "  copied $name"
  fi
}

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "Skipping install (--check-only). Running dependency check only."
else
  echo "Installing lanes commands to $CLAUDE_CMD (mode: $MODE)"

  for t in "${TARGETS[@]}"; do
    install_one "$t"
  done

  echo
  if [ "$MODE" = "symlink" ]; then
    echo "Done. After 'git pull' the new content is picked up automatically."
  else
    echo "Done. To pick up upstream changes later:"
    echo "  cd $REPO_DIR && git pull && ./install.sh --mode=copy"
  fi
fi

# ---------------------------------------------------------------------------
# Dependency self-check (advisory only — does not exit non-zero).
# Lets users install lanes first and dependencies after if they prefer.
#
# Severity:
#   [hard]      lanes cannot run any cycle without this
#   [hard:ship] required only by the forge ship phase; earlier phases run fine
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
  report "MISS" "superpowers plugin" "[hard]" "install in Claude Code:"
  echo "         /plugin marketplace add obra/superpowers-marketplace"
  echo "         /plugin install superpowers@superpowers-marketplace"
  echo "       Upstream docs: https://github.com/obra/superpowers#installation"
  echo "       forge/skills.json declares these skill names:"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.skills | to_entries[] | "         - \(.value)  (role: \(.key))"' \
       "$REPO_DIR/commands/forge/skills.json" 2>/dev/null || true
  else
    echo "         (install jq to see the list, or open commands/forge/skills.json)"
  fi
  echo "       Or edit skills.json to point at skills you do have."
  issues=$((issues + 1))
fi

# --- hard:ship: at least one of gh or glab ---
gh_present=0; glab_present=0
command -v gh   >/dev/null 2>&1 && gh_present=1
command -v glab >/dev/null 2>&1 && glab_present=1
if [ "$gh_present" -eq 1 ] && [ "$glab_present" -eq 1 ]; then
  report "OK" "gh + glab" "[hard:ship]" "both present — GitHub and GitLab forge:ship covered"
elif [ "$gh_present" -eq 1 ]; then
  report "OK" "gh" "[hard:ship]" "GitHub remotes covered; install glab for GitLab"
elif [ "$glab_present" -eq 1 ]; then
  report "OK" "glab" "[hard:ship]" "GitLab remotes covered; install gh for GitHub"
else
  report "MISS" "gh / glab" "[hard:ship]" "install at least one before running forge:ship"
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
  echo "All hard dependencies present. You're ready to /forge or /compass."
else
  echo "$issues hard dependency(ies) missing. lanes is installed but commands will"
  echo "fail at runtime until you address [hard] items above."
  echo "[soft] items are advisory; [hard:ship] items only matter at forge:ship."
fi
