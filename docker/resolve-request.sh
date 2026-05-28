#!/usr/bin/env bash
# resolve-request.sh — pure request-resolution helper for run-auto.sh.
#
# Sourced by docker/run-auto.sh and docker/test-run-auto-request.sh.
# Defines functions ONLY: it performs no top-level work and sets no shell
# options, so sourcing it is side-effect-free (callers own `set -euo pipefail`).
# The functions are written to behave correctly under the caller's set -euo
# pipefail.
#
# A request argument is PATH-LIKE when EITHER:
#   1. it begins with a path prefix:  ./  ../  /  or  ~/   ; OR
#   2. it is a single whitespace-free token whose name ends in a recognized
#      request-file extension:  .md  .markdown  or  .txt
# A path-like argument MUST resolve to a readable, non-empty regular file —
# otherwise resolve_request fails loudly (stderr + non-zero). Anything else is
# free text and is echoed back verbatim.

# is_path_like <arg> — return 0 when the argument is shaped like a file path.
is_path_like() {
  local arg="${1:-}"
  case "$arg" in
    "./"* | "../"* | "/"* | "~/"*) return 0 ;;
  esac
  if [[ "$arg" != *[[:space:]]* ]]; then
    case "$arg" in
      *.md | *.markdown | *.txt) return 0 ;;
    esac
  fi
  return 1
}

# resolve_request <arg> — print the resolved request text to stdout and return 0,
# or print an actionable message to stderr and return non-zero when a path-like
# argument cannot be read as a non-empty file.
resolve_request() {
  local arg="${1:-}"

  if ! is_path_like "$arg"; then
    printf '%s\n' "$arg"
    return 0
  fi

  local path="$arg"
  if [[ "$path" == "~/"* ]]; then
    path="$HOME/${path#"~/"}"
  fi

  if [[ -d "$path" ]]; then
    printf "ERROR: request '%s' is a directory, not a file.\n" "$arg" >&2
    return 1
  fi
  if [[ ! -e "$path" ]]; then
    printf "ERROR: request file '%s' not found.\n" "$arg" >&2
    return 1
  fi
  if [[ ! -r "$path" ]]; then
    printf "ERROR: request file '%s' is not readable.\n" "$arg" >&2
    return 1
  fi

  local contents
  contents="$(cat -- "$path")"
  if [[ -z "${contents//[$' \t\r\n']/}" ]]; then
    printf "ERROR: request file '%s' is empty.\n" "$arg" >&2
    return 1
  fi

  printf '%s\n' "$contents"
  return 0
}
