# /harness:approve — flip the current gate from needs-review to ok

You are clearing a gate so the harness cycle can resume. Read `~/.claude/commands/harness/PROTOCOL.md` first.

## Pre-flight

Read `.harness/state.json`. Expected: `status == "needs-review"` and `gate` is set.

If `status != "needs-review"`:
- If `status == "ok"`: this approve is redundant; report "already approved, nothing to do" and stop.
- If `status == "blocked"`: refuse; tell user to address blocker first.
- If `status == "done"`: refuse; cycle already finished.

## Steps

### 1. Confirm the user has seen the gate artifact

Read `.harness/state.json` → `gate.artifact` (e.g. `.harness/spec.md` or `.harness/plan.md`).

Show the user (assistant message, not Bash output) a 5-line summary of that file's headings and ask once: "Confirm approve?". The user can:
- Reply yes / OK / approve / 通过 → proceed.
- Reply anything else → stop, treat as wanting changes.

(This single confirm step is intentional: gates are too important to silently flip.)

### 2. Update state.json

Overwrite with:

```jsonc
{
  ...unchanged fields...,
  "status": "ok",
  "gate": null,
  "history": [<existing>, { "phase": "<current phase>", "status": "approved", "at": "<now>" }]
}
```

Note: `next` is **not** changed — it was set by the previous phase command and points to the right place.

### 3. Self-chain tail

Per PROTOCOL.md: `status == "ok"`, `next` is whatever the upstream phase wrote (`plan` after spec-review, `impl` after plan-review). Read `~/.claude/commands/harness/${next}.md` and execute immediately in the same turn.
