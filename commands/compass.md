# /compass — bootstrap a new compass cycle

You are bootstrapping a self-driving product-discussion cycle. Read `~/.claude/commands/PROTOCOL.md` first — it defines the state.json schema, self-chain tail, and AGENTS.md injection rules shared by forge and compass.

## Invocation

`/compass <fuzzy product idea>` — start a new cycle.

(Unlike `/forge`, compass does NOT support `/compass next`. Compass *produces* backlog items; it doesn't consume them.)

## Steps

### 1. Resolve REPO_ROOT and detect MODE

Walk up from `$(pwd)` up to 5 levels looking for `.git`:

```bash
DIR="$(pwd)"
REPO_ROOT=""
for i in 1 2 3 4 5; do
  if [ -d "$DIR/.git" ]; then
    REPO_ROOT="$DIR"; break
  fi
  DIR="$(dirname "$DIR")"
done
```

Then:

```
if   [ -z "$REPO_ROOT" ]:                                 MODE=fresh
elif [ ! -f "$REPO_ROOT/docs/product/STATUS.md" ]:         MODE=light
else:                                                      MODE=extend
```

### 2. Mode-specific setup

**MODE=fresh:**

The user is in an empty / non-repo directory. Ask via the AskUserQuestion tool:

```
Compass detected no git repo at $(pwd) or its parents.
Want to scaffold a new project here?
  - Option "Yes, scaffold at this path": uses current cwd as new repo root
  - Option "Yes, scaffold at custom path": ask for kebab-case project name → ~/Develop/personal/<name>/
  - Option "Cancel": halt, no changes
```

If user agrees, scaffold at target path:
```bash
mkdir -p "$REPO_ROOT/docs/product/decisions" "$REPO_ROOT/docs/lanes"
git -C "$REPO_ROOT" init
```

Write minimal `$REPO_ROOT/docs/product/STATUS.md`:
```markdown
# <project name> — 产品现状

**最后更新：** <today YYYY-MM-DD>
**阶段：** scaffold

## 一句话定位

<TBD — to be filled during /compass:discover>

## Hard Nos

<none yet>
```

Write `$REPO_ROOT/docs/lanes/backlog.md`:
```markdown
# Backlog — <project name>

This file is the handoff point between `/compass` (writes) and `/forge` (reads).

## Queued

## Dispatched

<!-- entries dispatched by /forge next get moved here with a timestamp -->
```

Add `.gitignore` with both `.forge-worktrees/` and `.compass-cycles/`.

If user cancels: halt with "compass cancelled — no scaffolding performed".

**MODE=light or MODE=extend:**

Check working tree is clean. If `git -C "$REPO_ROOT" status --porcelain | grep -v '^??'` is non-empty (i.e. has tracked changes, ignore untracked), halt with: "compass requires a clean working tree on the current branch. Commit or stash your changes, then re-run /compass."

### 3. Generate cycle_id

```bash
DATE=$(date +%Y-%m-%d)
SLUG=<3-6 kebab-case ASCII keywords from request>
CYCLE_ID="$DATE-$SLUG"
```

Check `<REPO_ROOT>/.compass-cycles/<CYCLE_ID>` doesn't already exist; if it does, append `-2`, `-3`, etc.

### 4. Ensure .gitignore has `.compass-cycles/`

If `$REPO_ROOT/.gitignore` does not contain a line equal to `.compass-cycles/`, append:

```
# lanes — compass cycle scratch
.compass-cycles/
```

If a change was made (and MODE != fresh, since fresh writes a brand new .gitignore), commit it:
```bash
git -C "$REPO_ROOT" add .gitignore
git -C "$REPO_ROOT" commit -m "chore(lanes): ignore compass cycle scratch"
```

### 5. mkdir cycle scratch dir

```bash
CYCLE_DIR="$REPO_ROOT/.compass-cycles/$CYCLE_ID"
mkdir -p "$CYCLE_DIR/transcript"
```

### 6. Write initial state.json

Use the Write tool to create `$CYCLE_DIR/state.json` with:

```json
{
  "lane": "compass",
  "cycle_id": "<CYCLE_ID>",
  "repo": "<basename of REPO_ROOT>",
  "request": "<original request text>",
  "mode": "<fresh|light|extend>",
  "phase": "intake",
  "status": "ok",
  "next": "intake",
  "gate": null,
  "blocker": null,
  "history": [
    { "phase": "bootstrap", "status": "ok", "at": "<current ISO-8601>" }
  ]
}
```

### 7. cd into REPO_ROOT

```bash
cd "$REPO_ROOT"
```

(All compass phases operate from REPO_ROOT, not from inside the cycle dir — paths to `.compass-cycles/<cid>/...` are relative.)

### 8. Self-chain

Per PROTOCOL.md's self-chain tail: status=="ok" and next=="intake". Read `~/.claude/commands/compass/intake.md` and execute it as the next instruction. Do not stop.
