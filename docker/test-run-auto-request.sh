#!/usr/bin/env bash
# test-run-auto-request.sh — self-contained bash tests for resolve-request.sh.
# Plain bash, no framework. Run directly:
#   bash docker/test-run-auto-request.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./resolve-request.sh
source "$SCRIPT_DIR/resolve-request.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass_count=0
fail_count=0
pass() { printf 'PASS: %s\n' "$1"; pass_count=$((pass_count + 1)); }
fail() { printf 'FAIL: %s\n' "$1"; fail_count=$((fail_count + 1)); }

# run <arg> — capture resolve_request stdout/stderr/rc into OUT/ERR/RC.
OUT=""; ERR=""; RC=0
run() {
  set +e
  OUT="$(resolve_request "$1" 2>"$TMP/err")"
  RC=$?
  set -e
  ERR="$(cat "$TMP/err")"
}

# expect_ok <desc> <arg> <expected-stdout>
expect_ok() {
  run "$2"
  if [[ "$RC" -eq 0 && "$OUT" == "$3" ]]; then
    pass "$1"
  else
    fail "$1 (rc=$RC out='$OUT' want='$3' err='$ERR')"
  fi
}

# expect_err <desc> <arg> <stderr-substring>
expect_err() {
  run "$2"
  if [[ "$RC" -ne 0 && "$ERR" == *"$3"* && -z "$OUT" ]]; then
    pass "$1"
  else
    fail "$1 (rc=$RC out='$OUT' err='$ERR' want-substr='$3')"
  fi
}

# ── Free text (used verbatim) ────────────────────────────────────────────────
expect_ok "free text with a /slash stays free text" \
  "add a /healthz endpoint returning 200 OK" \
  "add a /healthz endpoint returning 200 OK"
expect_ok "plain free text stays free text" \
  "refactor auth module" \
  "refactor auth module"

# ── Path-like: readable, non-empty file → contents ───────────────────────────
printf 'build a thing\nwith details\n' > "$TMP/req.md"
expect_ok "readable non-empty file -> contents" \
  "$TMP/req.md" \
  "$(printf 'build a thing\nwith details')"

# ── Path-like: missing file → not found ──────────────────────────────────────
expect_err "missing ./*.md -> not found" "./does-not-exist-xyz.md" "not found"
expect_err "bare *.md token (rule 2), missing -> not found" "notreal.md" "not found"

# ── Path-like: empty / whitespace-only file → empty ──────────────────────────
: > "$TMP/empty.md"
expect_err "empty file -> empty" "$TMP/empty.md" "empty"
printf '  \n\t\n' > "$TMP/ws.md"
expect_err "whitespace-only file -> empty" "$TMP/ws.md" "empty"

# ── Path-like: directory → not a file ────────────────────────────────────────
mkdir -p "$TMP/adir"
expect_err "directory -> not a file" "$TMP/adir" "directory"

# ── Path-like: unreadable file → not readable ────────────────────────────────
# root bypasses file permissions, so -r is always true there; skip to stay green.
printf 'secret\n' > "$TMP/locked.md"
chmod 000 "$TMP/locked.md"
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  printf 'SKIP: unreadable file -> not readable (running as root bypasses perms)\n'
else
  expect_err "unreadable file -> not readable" "$TMP/locked.md" "not readable"
fi
chmod 644 "$TMP/locked.md"

# ── is_path_like classification (direct) ─────────────────────────────────────
classify() { # <desc> <arg> <expect: yes|no>
  local got
  if is_path_like "$2"; then got="yes"; else got="no"; fi
  if [[ "$got" == "$3" ]]; then pass "$1"; else fail "$1 (got=$got want=$3)"; fi
}
classify "./ prefix is path-like"          "./x.md"                     "yes"
classify "../ prefix is path-like"         "../notes.txt"               "yes"
classify "/ prefix is path-like"           "/etc/req.md"                "yes"
classify "~/ prefix is path-like"          "~/req.md"                   "yes"
classify "bare .md token is path-like"     "spec.md"                    "yes"
classify "bare .markdown token path-like"  "spec.markdown"              "yes"
classify "free text is not path-like"      "add a /healthz endpoint"    "no"
classify "spaced .md phrase not path-like" "write the spec.md file"     "no"

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
if [[ "$fail_count" -ne 0 ]]; then
  exit 1
fi
