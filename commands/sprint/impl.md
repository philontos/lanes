# /sprint:impl — execute the backlog bullet, write code, run tests

You are running the **impl phase** of a sprint cycle. Read `~/.claude/commands/PROTOCOL.md` first.

Sprint impl differs from forge impl in one way: there is no `.lane/plan.md`. The de-facto plan is constructed inline from the backlog bullet's structured metadata (or from the freeform request, if no bullet was consumed).

## Model advisory check

Read `~/.claude/commands/sprint/skills.json`. Take `models.impl.advisory_session` (recommended: `sonnet med`). If current session doesn't match, advise once and proceed. Note: subagent dispatches in this phase use `models.impl.subagent` regardless of the session's model.

## Pre-flight

Read `.lane/state.json`. Confirm `phase` is `bootstrap` and `status == "ok"`. Update `phase` to `"impl"`.

Read AGENTS.md files in the worktree per PROTOCOL.md's AGENTS.md injection rules. These are hard constraints.

## Steps

### 1. Construct the de-facto plan

Sprint has no plan.md — the impl phase synthesizes its plan from `state.backlog_bullet` (or, if null, from `state.request` alone). Use this as the binding instruction set fed to the EXECUTE skill below.

Case A — `state.backlog_bullet` is non-null:

```
GOAL:    <state.backlog_bullet.parsed.goal,          or "(missing — title alone: <title>)">
SCOPE:   <state.backlog_bullet.parsed.scope,         or "(missing — infer minimally from goal)">
TOUCH:   <state.backlog_bullet.parsed.relevant_code, or "(missing — discover during impl)">
ORIGIN:  <state.backlog_bullet.parsed.origin,        or "(none)">
REQUEST: <state.request>
```

Case B — `state.backlog_bullet` is null (freeform `/sprint <text>`):

```
GOAL:    <state.request>
SCOPE:   (not pre-defined — infer minimally; do not expand)
TOUCH:   (not pre-defined — discover during impl)
REQUEST: <state.request>
```

Do NOT spend a turn writing this to a file — it lives inline as the prompt fed to EXECUTE in Step 3. Sprint deliberately avoids `.lane/plan.md` to keep the cycle light; the bullet on disk in `backlog.md` (and its copy in `state.backlog_bullet`) is the durable record.

### 2. Resolve skill names and subagent model

Read `~/.claude/commands/sprint/skills.json`. Take:
- `EXECUTE`         = `skills.execute`
- `TDD`             = `skills.tdd`
- `VERIFY`          = `skills.verify`
- `PARALLEL`        = `skills.parallel`
- `SUBAGENT_MODEL`  = `models.impl.subagent`  (default: `sonnet`)

(Per PROTOCOL.md "Skill resolution" — do not hard-code skill names.)

### 3. Execute

Invoke the `EXECUTE` skill with TDD mandatory, passing the GOAL/SCOPE/TOUCH/REQUEST block from Step 1 as the instruction. The skill runs inline in the current session — sprint's impl phase does NOT pre-shard work across parallel subagents the way forge does, because there is no plan with explicit `parallel: true` annotations to drive the split.

If during execution you identify a clear opportunity for parallel work (e.g. two independent files to touch with no shared state), you MAY dispatch via `PARALLEL` with `model: SUBAGENT_MODEL`. This is a judgment call, not a required step.

### 4. Verify before completion

Run the `VERIFY` skill on the diff:
- Run the project's test suite.
- Run linters / type checkers per project conventions.
- Confirm the diff stays within the SCOPE you derived in Step 1 (or, when SCOPE was missing, stays minimal and proportionate to GOAL).

### 5. Outcome routing

**On success (all tests / lints green, scope sane):**

Update state.json:
```jsonc
{ ..., "phase": "impl", "status": "ok", "next": "review",
  "history": [<existing>, { "phase": "impl", "status": "ok", "at": "<now>" }] }
```

Self-chain to `~/.claude/commands/sprint/review.md` immediately (per PROTOCOL.md tail).

**On failure (tests red, type errors, scope drift):**

Try at most 2 fix iterations within this phase. If still failing:

1. Write `.lane/blocker.md` with:
   - Last failing test names + first error message
   - What was tried
   - Suggested human entry point (which file / which test to look at)
2. Update state.json:
   ```jsonc
   { ..., "phase": "impl", "status": "blocked",
     "blocker": { "phase": "impl", "reason": "<one-line>", "last_action": "<one-line>", "transcript": ".lane/transcript/impl.log" },
     "history": [<existing>, { "phase": "impl", "status": "blocked", "at": "<now>" }] }
   ```
3. PushNotification + stop.

## Notes

- Commits happen during execution (EXECUTE + TDD already commit per task). Don't make extra commits here.
- Do NOT expand SCOPE silently. If you find you need to touch files outside the derived TOUCH set, stop and write a blocker noting the scope mismatch — that's signal the task wasn't ready for sprint and should be promoted to `/forge`.
- If the backlog bullet's metadata was very thin (warning fired at bootstrap), be conservative: smaller diff, fewer files, more questions left as TODOs in the PR body rather than addressed inline.
