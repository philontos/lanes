# /sprint — bootstrap a new sprint cycle (lightweight forge)

You are bootstrapping a self-driving feature delivery cycle in the **sprint lane** — the lightweight sibling of `/forge`. Read `~/.claude/commands/PROTOCOL.md` first.

Sprint differs from forge in three ways:

1. **No spec, no plan, no mid-cycle gates, no in-pipeline subagent review.** Phase chain is `impl → ship → done`.
2. **The backlog bullet's structured metadata (`goal` / `scope` / `relevant_code`) substitutes for a written plan.**
3. **Code review is delegated to the PR/MR** — a human reviewer (or a tool like `/ultrareview`) on GitHub/GitLab. Sprint does not run a subagent reviewer before opening the PR; doing so would duplicate the human review and is the largest avoidable cost.

Use sprint when the backlog item is already well-defined. Use `/forge` when the task is ambiguous enough to need its own spec/plan derivation.

> Runtime guidance: per PROTOCOL.md's "Task tracking restraint" section, phase commands MUST NOT decompose a single phase into TaskCreate sub-tasks. Sprint's value is speed; over-decomposition is the single biggest avoidable cost inside a cycle. Progress is reported via brief assistant messages, not task state.

## Two invocations

- `/sprint <free-text request>` — start a freeform cycle. Sprint will warn that no structured metadata is available and proceed using the request text alone.
- `/sprint next` — pop the top bullet from `<current repo>/docs/lanes/backlog.md` and use it as the cycle source.

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
test -n "$REPO_ROOT" || { echo "Not inside a sprint-eligible repo"; exit 1; }
```

### 2. Resolve REQUEST and parse backlog bullet

- If args == `next`:
  - Read `$REPO_ROOT/docs/lanes/backlog.md`.
  - Find the topmost **bullet block** under the heading `## Queued`. Block parsing follows the rules in PROTOCOL.md "Bullet block format" — identical to `/forge next`.
  - Use the title line's text (stripped of `- ` prefix and any trailing annotations) as REQUEST.
  - Parse structured metadata from continuation lines (`goal`, `scope`, `relevant_code`, `origin`, plus any other `^  (\w+):\s*(.*)$` pairs).
  - **Move the entire block** from `## Queued` to `## Dispatched` (create if missing; place before `## Completed`). Append `  *(dispatched <ISO-8601 now>)*` to the title line.
  - Halt with a clear message if backlog has no queued items.
- Else: REQUEST = the rest of args (trim whitespace). No `backlog_bullet` will be stashed.

### 3. Soft warning on missing metadata

Sprint's impl phase relies on `goal` / `scope` / `relevant_code` to substitute for a real plan. If any are missing, emit one assistant message:

- **Freeform invocation (no bullet at all):**
  ```
  ⚠ Sprint is running on a freeform request — no structured metadata available.
    Sprint has no spec/plan phase, so impl will work from the request text alone.
    If this task is ambiguous, consider running /forge instead.
    Proceeding.
  ```

- **`/sprint next` with partial metadata** (one or more of goal/scope/relevant_code missing):
  ```
  ⚠ Backlog bullet is missing: <comma-separated list of missing keys>.
    Sprint impl will rely on the title plus whatever metadata is present.
    Proceeding.
  ```

- **All three present:** no warning.

Do NOT prompt the user; warnings are informational. Continue to Step 4 in the same turn.

### 4. Generate cycle_id

Slug: 3-6 keywords from REQUEST, lowercase, kebab-case, ASCII only. Date: today's date in `YYYY-MM-DD`.

Check for collisions:
```bash
git -C "$REPO_ROOT" branch --list "sprint/$CYCLE_ID"
```
If non-empty, append `-2` (or `-3`, …) until unique.

### 5. Ensure .gitignore has `.sprint-worktrees/`

If `$REPO_ROOT/.gitignore` does not contain a line equal to `.sprint-worktrees/`, append:

```
# lanes — sprint worktrees
.sprint-worktrees/
```

If you made a change, commit it on `main` directly:
```bash
git -C "$REPO_ROOT" add .gitignore
git -C "$REPO_ROOT" commit -m "chore(lanes): ignore sprint worktrees"
```

### 6. Create worktree + branch

```bash
git -C "$REPO_ROOT" worktree add \
    "$REPO_ROOT/.sprint-worktrees/$CYCLE_ID" \
    -b "sprint/$CYCLE_ID"
```

### 7. Initialize .lane/

```bash
WT="$REPO_ROOT/.sprint-worktrees/$CYCLE_ID"
mkdir -p "$WT/.lane/transcript"
```

### 8. Write initial state.json

Use the Write tool to create `$WT/.lane/state.json` with:

```json
{
  "lane": "sprint",
  "cycle_id": "<CYCLE_ID>",
  "repo": "<basename of REPO_ROOT>",
  "request": "<REQUEST>",
  "phase": "bootstrap",
  "status": "ok",
  "next": "impl",
  "gate": null,
  "blocker": null,
  "backlog_bullet": null,
  "history": [
    { "phase": "bootstrap", "status": "ok", "at": "<current ISO-8601>" }
  ]
}
```

If Step 2 came from `/sprint next`, set `backlog_bullet` to:

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

Otherwise (freeform `/sprint <text>`), leave `backlog_bullet: null`.

### 9. cd into the worktree

```bash
cd "$WT"
```
All subsequent phase commands operate from this cwd.

### 10. Self-chain

Per PROTOCOL.md's self-chain tail: since `status == "ok"` and `next == "impl"`, immediately read `~/.claude/commands/sprint/impl.md` and execute it as the next instruction.

Do not stop. Continue into the impl phase in the same turn.
