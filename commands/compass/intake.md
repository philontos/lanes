# /compass:intake — gather context for the discover phase

Read `~/.claude/commands/PROTOCOL.md` first.

## Model advisory check

Read `~/.claude/commands/compass/skills.json`. Take `models.intake.advisory_session`. If the current session's model+effort doesn't match (recommendation is haiku low — mechanical), output a one-line advisory and continue regardless.

## Pre-flight

Locate the current cycle by reading the most recently created `.compass-cycles/<cycle_id>/state.json` showing `lane: "compass"`, `phase: "intake"`, `status: "ok"`.

Read state.json. Take `mode` and `cycle_id`.

## Steps

### 1. Build context.md based on mode

Path: `.compass-cycles/<cycle_id>/context.md`.

**mode=extend:**

```bash
CYCLE_DIR=".compass-cycles/<cycle_id>"
{
  echo "# Compass context — <cycle_id> (mode=extend)"
  echo
  echo "## Current STATUS.md"
  cat docs/product/STATUS.md
  echo
  echo "## Repo layout (depth 2, ignoring hidden)"
  find . -maxdepth 2 -type d -not -path '*/.*' | sort
  echo
  echo "## AGENTS.md files"
  find . -name AGENTS.md -not -path './.compass-cycles/*' -not -path './.forge-worktrees/*' -not -path './node_modules/*'
  echo
  echo "## README files at top level"
  ls README* 2>/dev/null || echo "(none)"
} > "$CYCLE_DIR/context.md"
```

**Critical**: do NOT include `docs/product/decisions/*.md` content. ADRs are write-only journal — never read for context.

**mode=light:**

```bash
{
  echo "# Compass context — <cycle_id> (mode=light)"
  echo
  echo "No existing docs/product/. Repo exists but no product baseline."
  echo
  echo "## Repo layout (depth 2, ignoring hidden)"
  find . -maxdepth 2 -type d -not -path '*/.*' | sort
  echo
  echo "## AGENTS.md files"
  find . -name AGENTS.md -not -path './.compass-cycles/*' -not -path './.forge-worktrees/*' -not -path './node_modules/*'
} > "$CYCLE_DIR/context.md"
```

**mode=fresh:**

```bash
{
  echo "# Compass context — <cycle_id> (mode=fresh)"
  echo
  echo "Fresh project: $(basename $(pwd))"
  echo "Root: $(pwd)"
  echo "No prior product baseline. discover phase starts from scratch."
} > "$CYCLE_DIR/context.md"
```

### 2. Update state.json

Overwrite with:

```jsonc
{
  ...unchanged...,
  "phase": "intake",
  "status": "ok",
  "next": "discover",
  "history": [<existing>, { "phase": "intake", "status": "ok", "at": "<now>" }]
}
```

### 3. Self-chain tail

`status == "ok"`, `next == "discover"`. Read `~/.claude/commands/compass/discover.md` and execute it as the next instruction. Do not stop.

## Blocker handling

If `cat docs/product/STATUS.md` fails on mode=extend (shouldn't happen if mode was detected correctly), write `.compass-cycles/<cid>/blocker.md` with the error and set state to blocked.
