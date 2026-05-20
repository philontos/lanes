# /forge — bootstrap a new forge cycle

You are bootstrapping a self-driving feature delivery cycle. Read `~/.claude/commands/PROTOCOL.md` first — it defines the state.json schema, self-chain tail, and AGENTS.md injection rules shared by forge and compass.

## Two invocations

- `/forge <free-text request>` — start a new cycle with that request.
- `/forge next` — pop the top bullet from `<current repo>/docs/lanes/backlog.md` and use its text as the request.

## Steps

### 1. Resolve REPO_ROOT

Walk up from `$(pwd)` until you find a directory containing both `.git` and `AGENTS.md`. If you can't find one within 5 levels, halt: this command only runs inside a repo with an `AGENTS.md` at its root.

```bash
DIR="$(pwd)"
for i in 1 2 3 4 5; do
  if [ -d "$DIR/.git" ] && [ -f "$DIR/AGENTS.md" ]; then
    REPO_ROOT="$DIR"; break
  fi
  DIR="$(dirname "$DIR")"
done
test -n "$REPO_ROOT" || { echo "Not inside a forge-eligible repo"; exit 1; }
```

### 2. Resolve REQUEST

- If args == `next`:
  - Read `$REPO_ROOT/docs/lanes/backlog.md`.
  - Find the topmost **bullet block** under the heading `## Queued`:
    - The block starts with a line matching `^- ` (the title line).
    - It includes every immediately-following continuation line (lines starting with whitespace, plus any empty lines between continuation lines).
    - The block ends at the next `^- ` (next bullet), the next `^## ` (next section), or EOF.
  - Use the title line's text (stripped of `- ` prefix and any trailing `*(dispatched ...)*` annotation if re-dispatch) as REQUEST.
  - **Parse structured metadata** from the continuation lines: any line matching `^  (\w+):\s*(.*)$` → key/value pair. Typical keys: `goal`, `scope`, `relevant_code`, `origin`. Unknown keys are also captured.
  - **Move the entire block** (title + all continuation lines) from `## Queued` to a `## Dispatched` section. Create it if missing (place it before `## Completed` if Completed exists, else at end of file). Append `  *(dispatched <ISO-8601 now>)*` to the title line.
  - Remember the block for Step 7 (will be stashed into `state.backlog_bullet`).
  - Halt with a clear message if backlog has no queued items.
- Else: REQUEST = the rest of args (trim whitespace). No `backlog_bullet` will be stashed.

### 3. Generate cycle_id

Slug: 3-6 keywords from REQUEST, lowercase, kebab-case, ASCII only. Date: today's date in `YYYY-MM-DD`.

Check for collisions:
```bash
git -C "$REPO_ROOT" branch --list "forge/$CYCLE_ID"
```
If non-empty, append `-2` (or `-3`, …) until unique.

### 4. Ensure .gitignore has `.forge-worktrees/`

If `$REPO_ROOT/.gitignore` does not contain a line equal to `.forge-worktrees/`, append:

```
# lanes — forge worktrees
.forge-worktrees/
```

If you made a change, commit it on `main` directly:
```bash
git -C "$REPO_ROOT" add .gitignore
git -C "$REPO_ROOT" commit -m "chore(lanes): ignore forge worktrees"
```

### 5. Create worktree + branch

```bash
git -C "$REPO_ROOT" worktree add \
    "$REPO_ROOT/.forge-worktrees/$CYCLE_ID" \
    -b "forge/$CYCLE_ID"
```

### 6. Initialize .lane/

```bash
WT="$REPO_ROOT/.forge-worktrees/$CYCLE_ID"
mkdir -p "$WT/.lane/transcript"
```

### 7. Write initial state.json

Use the Write tool to create `$WT/.lane/state.json` with:

```json
{
  "lane": "forge",
  "cycle_id": "<CYCLE_ID>",
  "repo": "<basename of REPO_ROOT>",
  "request": "<REQUEST>",
  "phase": "spec",
  "status": "ok",
  "next": "spec",
  "gate": null,
  "blocker": null,
  "backlog_bullet": null,
  "history": [
    { "phase": "bootstrap", "status": "ok", "at": "<current ISO-8601>" }
  ]
}
```

If Step 2 came from `/forge next`, set `backlog_bullet` to:

```json
{
  "raw": "<the entire original bullet block, including title and indented continuation lines, verbatim>",
  "parsed": {
    "title":         "<title without `- ` prefix and without any trailing annotation>",
    "origin":        "<value of 'origin:' key, or null>",
    "goal":          "<value of 'goal:' key, or null>",
    "scope":         "<value of 'scope:' key, or null>",
    "relevant_code": "<value of 'relevant_code:' key, or null>"
  }
}
```

Otherwise (freeform `/forge <text>`), leave `backlog_bullet: null`.

### 8. cd into the worktree

```bash
cd "$WT"
```
All subsequent phase commands operate from this cwd.

### 9. Self-chain

Per PROTOCOL.md's self-chain tail: since `status == "ok"` and `next == "spec"`, immediately read `~/.claude/commands/forge/spec.md` and execute it as the next instruction.

Do not stop. Continue into the spec phase in the same turn.
