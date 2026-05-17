# /harness — bootstrap a new autonomous cycle

You are bootstrapping a self-driving development cycle. Read `~/.claude/commands/harness/PROTOCOL.md` first — it defines the state.json schema, self-chain tail, and AGENTS.md injection rules that all `/harness:*` commands share.

## Two invocations

- `/harness <free-text request>` — start a new cycle with that request.
- `/harness next` — pop the top bullet from `<current repo>/docs/harness/backlog.md` and use its text as the request.

## Steps

### 1. Resolve REPO_ROOT

Walk up from `$(pwd)` until you find a directory containing both `.git` and `AGENTS.md`. If you can't find one within 5 levels, halt: this command only runs inside engram or phronos.

```bash
DIR="$(pwd)"
for i in 1 2 3 4 5; do
  if [ -d "$DIR/.git" ] && [ -f "$DIR/AGENTS.md" ]; then
    REPO_ROOT="$DIR"; break
  fi
  DIR="$(dirname "$DIR")"
done
test -n "$REPO_ROOT" || { echo "Not inside a harness-eligible repo"; exit 1; }
```

### 2. Resolve REQUEST

- If args == `next`:
  - Read `$REPO_ROOT/docs/harness/backlog.md`.
  - Find the topmost line matching `^- ` under the heading `## Queued`.
  - Use its text (without the `- ` prefix) as REQUEST.
  - Move that line to a `## Dispatched` section at the bottom (create it if missing), with an ISO timestamp suffix `  *(dispatched 2026-05-17T10:30:00Z)*`.
  - Halt with a clear message if backlog has no queued items.
- Else: REQUEST = the rest of args (trim whitespace).

### 3. Generate cycle_id

Slug: 3-6 keywords from REQUEST, lowercase, kebab-case, ASCII only. Date: today's date in `YYYY-MM-DD`.

Check for collisions:
```bash
git -C "$REPO_ROOT" branch --list "harness/$CYCLE_ID"
```
If non-empty, append `-2` (or `-3`, …) until unique.

### 4. Ensure .gitignore has `.harness-worktrees/`

If `$REPO_ROOT/.gitignore` does not contain a line equal to `.harness-worktrees/`, append:

```
# autonomous harness — cycle worktrees
.harness-worktrees/
```

If you made a change, commit it on `main` directly:
```bash
git -C "$REPO_ROOT" add .gitignore
git -C "$REPO_ROOT" commit -m "chore: ignore harness worktrees"
```

### 5. Create worktree + branch

```bash
git -C "$REPO_ROOT" worktree add \
    "$REPO_ROOT/.harness-worktrees/$CYCLE_ID" \
    -b "harness/$CYCLE_ID"
```

### 6. Initialize .harness/

```bash
WT="$REPO_ROOT/.harness-worktrees/$CYCLE_ID"
mkdir -p "$WT/.harness/transcript"
```

### 7. Write initial state.json

Use the Write tool to create `$WT/.harness/state.json` with:

```json
{
  "cycle_id": "<CYCLE_ID>",
  "repo": "<basename of REPO_ROOT>",
  "request": "<REQUEST>",
  "phase": "spec",
  "status": "ok",
  "next": "spec",
  "gate": null,
  "blocker": null,
  "history": [
    { "phase": "bootstrap", "status": "ok", "at": "<current ISO-8601>" }
  ]
}
```

### 8. cd into the worktree

```bash
cd "$WT"
```
All subsequent phase commands operate from this cwd.

### 9. Self-chain

Per PROTOCOL.md's self-chain tail: since `status == "ok"` and `next == "spec"`, immediately read `~/.claude/commands/harness/spec.md` and execute it as if it were the next instruction.

Do not stop. Continue into the spec phase in the same turn.
