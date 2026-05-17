# /harness:impl — execute the plan, write code, run tests

You are running the **impl phase**. Read `~/.claude/commands/harness/PROTOCOL.md` first.

## Pre-flight

Read `.harness/state.json`. Confirm `phase` is `plan` and `status == "ok"`. Update `phase` to `"impl"`.

Read `.harness/plan.md` — execute it task by task.

## Steps

### 1. Resolve skill names

Read `~/.claude/commands/harness/skills.json`. Take these four entries:
- `EXECUTE` = `skills.execute`
- `TDD` = `skills.tdd`
- `VERIFY` = `skills.verify`
- `PARALLEL` = `skills.parallel`

(Per PROTOCOL.md "Skill resolution" — do not hard-code skill names. The constraints below refer to these variables.)

### 2. Detect parallelism opportunities

Scan plan.md for tasks annotated with `parallel: true` near the top of the task body. Group consecutive parallel tasks. For each group:

- If the group has ≥ 2 tasks: dispatch them using the `PARALLEL` skill. Each subagent runs the `EXECUTE` skill scoped to its single task, with `TDD` mandatory.
- If the group has 1 task or non-parallel: execute inline using the `EXECUTE` skill + `TDD`.

### 3. Verify before completion

After all tasks attempted, run the `VERIFY` skill on the diff:
- Run the project's test suite.
- Run linters / type checkers per project conventions.
- Compare the diff against `.harness/spec.md` — every "in scope" item should be addressed; every "out of scope" item should be untouched.

### 4. Outcome routing

**On success (all tests / lints green, scope match):**

Update state.json:
```jsonc
{ ..., "phase": "impl", "status": "ok", "next": "review",
  "history": [<existing>, { "phase": "impl", "status": "ok", "at": "<now>" }] }
```

Self-chain to `review.md` immediately (per PROTOCOL.md tail).

**On failure (tests red, type errors, scope drift):**

Try at most 2 fix iterations within this phase. If still failing:

1. Write `.harness/blocker.md` with:
   - Last failing test names + first error message
   - What was tried
   - Suggested human entry point (which file / which test to look at)
2. Update state.json:
   ```jsonc
   { ..., "phase": "impl", "status": "blocked",
     "blocker": { "phase": "impl", "reason": "<one-line>", "last_action": "<one-line>", "transcript": ".harness/transcript/impl.log" },
     "history": [<existing>, { "phase": "impl", "status": "blocked", "at": "<now>" }] }
   ```
3. PushNotification + stop.

## Notes

- Commits happen during execution (the EXECUTE skill + TDD already commit per task). Don't make extra commits.
- If a subagent fails its task, treat that as one of the 2 fix iterations; you may retry it inline rather than re-dispatching.
- Do NOT touch files outside the spec's "in scope" list, even if a test happens to need it.
