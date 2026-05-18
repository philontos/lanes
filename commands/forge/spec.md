# /forge:spec — discover the feature, produce spec.md

You are running the **spec phase** of a forge cycle. Read `~/.claude/commands/PROTOCOL.md` first.

## Model advisory check

Read `~/.claude/commands/forge/skills.json`. Take `models.spec.advisory_session` (recommended: `opus high` — spec phase is design-heavy). If the current session's model+effort doesn't match, output one assistant message:

```
spec phase benefits from deeper thinking. Recommended: {advisory_session}.
Switch with /model opus, or continue on the current model.
```

Then proceed regardless.

## Pre-flight

Read `.lane/state.json`. Confirm `phase == "spec"`. If not, halt.

## Steps

### 1. Inject AGENTS.md

Per PROTOCOL.md's "AGENTS.md 注入" section, find and read every `AGENTS.md` file in the worktree:

```bash
find . -name AGENTS.md -not -path './.forge-worktrees/*'
```

Read all of them. Treat their hard rules as inviolable constraints for the entire cycle.

### 2. Read the request

From state.json, take `request` as the feature description.

### 2.5. Detect compass origin (compass → forge handoff)

The forge bootstrap may have copied bullet annotations from `docs/lanes/backlog.md` into state.json (or you may need to look them up). Specifically:

- If the original backlog bullet had an `origin: compass-cycle <id> [/ ADR-<NNN>]` line, **load** the discovery context from that compass cycle:
  - Read `.compass-cycles/<id>/discovery.md` if it exists in the active repo (compass writes to repo root, not the worktree — so look at `<REPO_ROOT>/.compass-cycles/<id>/discovery.md`, going up from the worktree).
  - Read the linked ADR (`<REPO_ROOT>/docs/product/decisions/<NNN>-*.md`) if specified.

- If the bullet had a `relevant_code: <paths>` line, **read those paths** (using Read or Glob) to ground the spec in actual current code.

If neither origin nor relevant_code is present (e.g. user manually wrote the bullet or typed `/forge <freeform>`), proceed without loading any compass context.

When compass context IS loaded, **shorten** the upcoming brainstorming:
- SKIP "problem space / target user / why now" questions (compass already covered these — re-deriving wastes the user's time).
- FOCUS on technical specifics: files to touch, test strategy, edge cases, API design, integration points.

When no compass context exists, run brainstorming fully as before.

### 3. Invoke the discovery skill

Resolve the skill name: read `~/.claude/commands/forge/skills.json` and take `skills.discover`. Pass that string to the Skill tool. (Per PROTOCOL.md "Skill resolution" — do not hard-code skill names.)

Goal: produce a spec for the requested feature. Constraints:

- The spec must respect every hard rule in the AGENTS.md files you just read.
- Save the spec to `.lane/spec.md` (NOT to the default `docs/superpowers/specs/` — cycle specs live with the cycle).
- During brainstorming, ask the user clarifying questions interactively if needed.
- The output spec must include: goal, scope (in / out), files to touch (best estimate), success criteria, risk notes.

When the discovery skill reaches the "user reviews spec" gate, you do NOT proceed to the plan phase — that's a separate command (`/forge:plan`). Stop after spec.md is committed-ready (don't commit; commits happen in the impl phase).

### 4. Update state.json

Overwrite `.lane/state.json`:

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
    "artifact": ".lane/spec.md",
    "approve_cmd": "/forge:approve"
  },
  "blocker": null,
  "history": [<existing entries…>, { "phase": "spec", "status": "needs-review", "at": "<now>" }]
}
```

### 5. Self-chain tail

Per PROTOCOL.md: since `status == "needs-review"`, call PushNotification with:

```
{cycle_id}: spec-review ready, run /forge:approve
```

Then let the turn end. The user will read `.lane/spec.md`, optionally edit it, and run `/forge:approve` to proceed.

## Blocker handling

If the discovery skill cannot complete (e.g. user repeatedly rejects approaches, ambiguity unresolvable, requirements contradict AGENTS.md), write a `blocker` instead:

1. Write `.lane/blocker.md` with: what was attempted, what failed, what the user might need to clarify.
2. Update state.json with `status:"blocked"`, fill `blocker` field.
3. PushNotification per protocol.
4. Stop.
