# /harness:spec — discover the feature, produce spec.md

You are running the **spec phase** of an autonomous harness cycle. Read `~/.claude/commands/harness/PROTOCOL.md` first.

## Pre-flight

Read `.harness/state.json`. Confirm `phase == "spec"`. If not, halt.

## Steps

### 1. Inject AGENTS.md

Per PROTOCOL.md's "AGENTS.md 注入" section, find and read every `AGENTS.md` file in the worktree:

```bash
find . -name AGENTS.md -not -path './.harness-worktrees/*'
```

Read all of them. Treat their hard rules as inviolable constraints for the entire cycle.

### 2. Read the request

From state.json, take `request` as the feature description.

### 3. Invoke the discovery skill

Resolve the skill name: read `~/.claude/commands/harness/skills.json` and take `skills.discover`. Pass that string to the Skill tool. (Per PROTOCOL.md "Skill resolution" — do not hard-code skill names.)

Goal: produce a spec for the requested feature. Constraints:

- The spec must respect every hard rule in the AGENTS.md files you just read.
- Save the spec to `.harness/spec.md` (NOT to the default `docs/superpowers/specs/` — harness specs live with the cycle).
- During brainstorming, ask the user clarifying questions interactively if needed.
- The output spec must include: goal, scope (in / out), files to touch (best estimate), success criteria, risk notes.

When the discovery skill reaches the "user reviews spec" gate, you do NOT proceed to the plan phase — that's a separate command (`/harness:plan`). Stop after spec.md is committed-ready (don't commit; commits happen in the impl phase).

### 4. Update state.json

Overwrite `.harness/state.json`:

```json
{
  "cycle_id": "<unchanged>",
  "repo": "<unchanged>",
  "request": "<unchanged>",
  "phase": "spec",
  "status": "needs-review",
  "next": "plan",
  "gate": {
    "kind": "spec-review",
    "artifact": ".harness/spec.md",
    "approve_cmd": "/harness:approve"
  },
  "blocker": null,
  "history": [<existing entries…>, { "phase": "spec", "status": "needs-review", "at": "<now>" }]
}
```

### 5. Self-chain tail

Per PROTOCOL.md: since `status == "needs-review"`, call PushNotification with:

```
{cycle_id}: spec-review ready, run /harness:approve
```

Then let the turn end. The user will read `.harness/spec.md`, optionally edit it, and run `/harness:approve` to proceed.

## Blocker handling

If the discovery skill cannot complete (e.g. user repeatedly rejects approaches, ambiguity unresolvable, requirements contradict AGENTS.md), write a `blocker` instead:

1. Write `.harness/blocker.md` with: what was attempted, what failed, what the user might need to clarify.
2. Update state.json with `status:"blocked"`, fill `blocker` field.
3. PushNotification per protocol.
4. Stop.
