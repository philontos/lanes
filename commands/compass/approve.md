# /compass:approve — flip the current gate from needs-review to ok

You are clearing a gate so the compass cycle can resume. Read `~/.claude/commands/PROTOCOL.md` first.

## Model advisory check (skip if compass/skills.json `models.approve.advisory_session` matches current session)

Read `~/.claude/commands/compass/skills.json`. Take `models.approve.advisory_session`. If the current session's model+effort does NOT match (e.g. you're on opus high but the recommendation is haiku low), output **one** assistant message:

```
This phase recommends a cheaper model ({advisory_session}). 
Approve is mechanical — switch with /model haiku, or continue on your current model (no harm).
```

Then proceed regardless. The advisory is informational only.

## Pre-flight

Locate the current cycle: find the most recent `.compass-cycles/<cycle_id>/` directory with `state.json` showing `lane: "compass"` and `status: "needs-review"`. If multiple match, halt with "ambiguous: which cycle?".

Read `.compass-cycles/<cycle_id>/state.json`. Expected: `status == "needs-review"` and `gate` is set.

If `status != "needs-review"`:
- If `status == "ok"`: this approve is redundant; report "already approved, nothing to do" and stop.
- If `status == "blocked"`: refuse; tell user to address the blocker first.
- If `status == "done"`: refuse; cycle already finished.

## Steps

### 1. Confirm the user has seen the gate artifact

Read `state.json` → `gate.artifact` (e.g. `.compass-cycles/<cid>/discovery.md` or `decisions.md`).

Show the user (assistant message, not Bash output) a 5-line summary of the file's headings and ask once: "Confirm approve?". The user can:
- Reply yes / OK / approve / 通过 → proceed.
- Reply anything else → stop, treat as wanting changes.

### 2. Update state.json

Overwrite with:

```jsonc
{
  ...unchanged fields...,
  "status": "ok",
  "gate": null,
  "history": [<existing>, { "phase": "<current phase>", "status": "approved", "at": "<now ISO-8601>" }]
}
```

`next` is unchanged — it was set by the previous phase command and points to the right place.

### 3. Self-chain tail

Per PROTOCOL.md: `status == "ok"`, `next` is whatever the upstream phase wrote (`decide` after discover-review, `materialize` after decide-review). Read `~/.claude/commands/compass/${next}.md` and execute immediately in the same turn.
