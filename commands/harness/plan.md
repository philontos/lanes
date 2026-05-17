# /harness:plan — turn spec.md into an actionable implementation plan

You are running the **plan phase**. Read `~/.claude/commands/harness/PROTOCOL.md` first.

## Pre-flight

Read `.harness/state.json`. Confirm `phase` is `spec` and `status == "ok"` (i.e. user just approved spec). Update `phase` to `"plan"` in state.json immediately so it reflects current work.

Read `.harness/spec.md` — it's the basis for planning.

## Steps

### 1. Invoke the planning skill

Resolve the skill name: read `~/.claude/commands/harness/skills.json` and take `skills.plan`. Pass that string to the Skill tool. (Per PROTOCOL.md "Skill resolution" — do not hard-code skill names.)

Goal: produce a bite-sized, TDD-flavored, no-placeholder plan.

Constraints for this invocation:
- The spec input is `.harness/spec.md`.
- Save the plan to `.harness/plan.md` (NOT the skill's default location — cycle-local).
- Each task in the plan must include exact file paths inside the worktree.
- For impl tasks that are independent of each other, mark them with a `parallel: true` annotation in a comment line at the top of the task — this hint is consumed in the impl phase.

If the planning skill normally offers "Subagent-Driven vs Inline" execution choice at the end — **suppress that prompt**. The harness impl phase handles execution; do not ask.

### 2. Update state.json

Overwrite:

```jsonc
{
  ...,
  "phase": "plan",
  "status": "needs-review",
  "next": "impl",
  "gate": {
    "kind": "plan-review",
    "artifact": ".harness/plan.md",
    "approve_cmd": "/harness:approve"
  },
  "history": [<existing>, { "phase": "plan", "status": "needs-review", "at": "<now>" }]
}
```

### 3. Self-chain tail

`status == "needs-review"` → PushNotification:
```
{cycle_id}: plan-review ready, run /harness:approve
```
Stop.

## Blocker handling

If the planning skill cannot produce a no-placeholder plan (e.g. spec has fundamental gaps), write `.harness/blocker.md`, set state to `blocked`, notify, stop.
