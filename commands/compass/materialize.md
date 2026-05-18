# /compass:materialize — write artifacts to disk, commit

You are running the **materialize phase** — the terminal phase. Read `~/.claude/commands/PROTOCOL.md` first.

## Model advisory check

Read `~/.claude/commands/compass/skills.json`. Take `models.materialize.advisory_session` (recommended: `haiku low` — mechanical work). Advise once, proceed.

## Pre-flight

Locate the current cycle. Read state.json. Confirm `phase == "decide"` and `status == "ok"`. Update `phase` to `"materialize"`.

Read `.compass-cycles/<cycle_id>/decisions.md`.

## Steps

### 1. Append tactical bullets to backlog.md

For each item under `## Tactical` in decisions.md, append a bullet to `<REPO_ROOT>/docs/lanes/backlog.md` under `## Queued` (end of section, FIFO). Format strictly per PROTOCOL §"Backlog handoff format":

```
- <one-line title>
  goal: <from decisions.md>
  scope: in: <...>; out: <...>
  relevant_code: <from decisions.md, or 'unknown' if absent>
  origin: compass-cycle <cycle_id>
```

If `docs/lanes/backlog.md` doesn't exist yet (mode=fresh, or repo never used lanes), create it with the standard header:

```markdown
# Backlog — <basename of REPO_ROOT>

This file is the handoff point between `/compass` (writes) and `/forge` (reads).

- `/compass` materialize phase **appends** bullets to `## Queued`.
- `/forge next` **pops** the topmost bullet from `## Queued` and moves it to `## Dispatched` with a timestamp.

## Queued

## Dispatched

<!-- entries dispatched by /forge next get moved here with a timestamp -->
```

Then append the bullets.

### 2. Apply status-changing items (skip if none)

For each item under `## Status-changing` in decisions.md:

**a) Edit STATUS.md** per the decisions.md "STATUS.md edit" instruction. Use the Edit tool. Common edits:
- Append bullet to "Hard Nos" section
- Modify positioning paragraph / 灵魂句
- Add / remove section

**b) Write ADR archive**:

Determine next ADR number:
```bash
LAST=$(ls "$REPO_ROOT/docs/product/decisions/" 2>/dev/null \
       | grep -E '^[0-9]+' | sed 's/-.*//' | sort -n | tail -1)
NEXT=$((${LAST:-0} + 1))
NEXT_PADDED=$(printf "%03d" $NEXT)
```

Path: `$REPO_ROOT/docs/product/decisions/<NEXT_PADDED>-<adr-slug>.md`

Content (use the simplified frontmatter — write-only journal, no status / supersedes / superseded_by / Consequences):

```markdown
---
number: <NEXT>
date: <today YYYY-MM-DD>
title: <from decisions.md>
---

## 上下文

<from decisions.md ADR body draft, 2-3 sentences>

## 决策

<one-line conclusion>

## 当时的理由

<from decisions.md ADR body draft, 2-3 sentences>
```

**c) If the status-changing item has `implementation work`** (a sub-bullet in decisions.md): also append a backlog bullet for that work, with `origin: compass-cycle <cycle_id> / ADR-<NEXT>`.

### 3. Single commit on main

Skip git commit if MODE=fresh (the repo was just initialized; commit may need different setup) — instead, leave the working tree dirty for the user to inspect and commit manually. Otherwise:

```bash
git -C "$REPO_ROOT" add \
    docs/lanes/backlog.md \
    docs/product/STATUS.md \
    docs/product/decisions/

git -C "$REPO_ROOT" commit -m "compass: <one-line cycle summary, derived from request>

- status-changing: <N> item(s) (ADR <NNN>[, <NNN+1>, ...])
- tactical: <M> backlog item(s)
"
```

Do NOT push, do NOT open PR. Compass is documentation work — the user pushes manually when ready.

If no changes to commit (zero tactical AND zero status-changing — shouldn't happen if discover and decide ran well), skip the commit and set state.outputs.commit = null.

### 4. Update state.json

```jsonc
{
  ...,
  "phase": "materialize",
  "status": "done",
  "next": null,
  "outputs": {
    "backlog_items_added": <M>,
    "adrs_added": [<NNN>, <NNN+1>, ...],
    "status_edited": <true|false>,
    "commit_sha": "<short SHA, or null if no commit>"
  },
  "history": [<existing>, { "phase": "materialize", "status": "done", "at": "<now>" }]
}
```

### 5. Self-chain tail (terminal)

`status == "done"` → PushNotification:

```
{cycle_id}: done ✓ — {M} backlog item(s), {N} ADR(s), STATUS {edited|unchanged}
```

Stop. The cycle scratch dir (`.compass-cycles/<cycle_id>/`) remains on disk for inspection. User removes when satisfied:

```bash
rm -rf .compass-cycles/<cycle_id>/
```

## Blocker handling

- If git commit fails (auth, hook, conflict): write blocker with the exact command + stderr.
- If decisions.md references a STATUS.md section that doesn't exist: write blocker listing the misaligned items and ask user to refine decisions.md before re-running materialize.
- If a status-changing item has no `ADR title:` in decisions.md: write blocker "decisions.md item N is status-changing but missing ADR title; refine and retry".
