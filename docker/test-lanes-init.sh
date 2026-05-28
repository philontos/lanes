#!/usr/bin/env bash
# test-lanes-init.sh — self-contained bash tests for lanes-init.sh.
# Plain bash, no framework. Run directly:
#   bash docker/test-lanes-init.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INIT="$SCRIPT_DIR/lanes-init.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass_count=0
fail_count=0
pass() { printf 'PASS: %s\n' "$1"; pass_count=$((pass_count + 1)); }
fail() { printf 'FAIL: %s\n' "$1"; fail_count=$((fail_count + 1)); }

# ── Scaffolds the 5 files into a fresh dir ──────────────────────────────────
mkdir -p "$TMP/repo-a"
( cd "$TMP/repo-a" && git init -q )
if "$INIT" "$TMP/repo-a" > "$TMP/out-a" 2> "$TMP/err-a"; then
  pass "init returns 0 on a fresh git repo"
else
  fail "init failed (out: $(cat "$TMP/out-a"); err: $(cat "$TMP/err-a"))"
fi

for f in summary.md spec.md features.json plan.md backlog.json; do
  if [[ -f "$TMP/repo-a/.lanes/$f" ]]; then
    pass ".lanes/$f exists"
  else
    fail ".lanes/$f missing"
  fi
done

# ── spec.md has all six required H2 sections ────────────────────────────────
for section in "Goal" "Scope IN" "Scope OUT" "Success Criteria" "Open Questions" "Constraints"; do
  if grep -q "^## $section$" "$TMP/repo-a/.lanes/spec.md"; then
    pass "spec.md has '## $section'"
  else
    fail "spec.md missing '## $section'"
  fi
done

# ── features.json and backlog.json are valid JSON with empty arrays ─────────
if node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(d.next_id_seq===1 && Array.isArray(d.features) && d.features.length===0 ? 0 : 1)' \
   "$TMP/repo-a/.lanes/features.json" 2>/dev/null; then
  pass "features.json parses, next_id_seq=1, empty features[]"
else
  fail "features.json invalid"
fi

if node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(d.next_id_seq===1 && Array.isArray(d.items) && d.items.length===0 ? 0 : 1)' \
   "$TMP/repo-a/.lanes/backlog.json" 2>/dev/null; then
  pass "backlog.json parses, next_id_seq=1, empty items[]"
else
  fail "backlog.json invalid"
fi

# ── Refuses to overwrite existing .lanes/ ───────────────────────────────────
set +e
"$INIT" "$TMP/repo-a" > "$TMP/out-b" 2> "$TMP/err-b"
RC=$?
set -e
if [[ "$RC" -ne 0 && "$(cat "$TMP/err-b")" == *"already exists"* ]]; then
  pass "re-init refuses to overwrite existing .lanes/"
else
  fail "re-init should have failed loud (rc=$RC err=$(cat "$TMP/err-b"))"
fi

# ── Auto-inits git in a non-repo dir ────────────────────────────────────────
mkdir -p "$TMP/repo-b"
"$INIT" "$TMP/repo-b" > /dev/null 2>&1
if git -C "$TMP/repo-b" rev-parse --git-dir > /dev/null 2>&1; then
  pass "init auto-creates a git repo when target is not one"
else
  fail "git repo not initialised"
fi

# ── Defaults to $PWD when no arg given ──────────────────────────────────────
mkdir -p "$TMP/repo-c"
( cd "$TMP/repo-c" && "$INIT" > /dev/null 2>&1 )
if [[ -d "$TMP/repo-c/.lanes" ]]; then
  pass "init defaults to PWD when called with no arg"
else
  fail "init with no arg did not scaffold in PWD"
fi

# ── Fails loud on missing target dir ────────────────────────────────────────
set +e
"$INIT" "$TMP/does-not-exist" > "$TMP/out-d" 2> "$TMP/err-d"
RC=$?
set -e
if [[ "$RC" -ne 0 && "$(cat "$TMP/err-d")" == *"does not exist"* ]]; then
  pass "init fails loud on missing target dir"
else
  fail "init should have failed loud on missing dir (rc=$RC err=$(cat "$TMP/err-d"))"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
if [[ "$fail_count" -ne 0 ]]; then
  exit 1
fi
