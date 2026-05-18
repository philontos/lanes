# /compass:discover — brainstorm the product idea

You are running the **discover phase**. Read `~/.claude/commands/PROTOCOL.md` first.

## Model advisory check

Read `~/.claude/commands/compass/skills.json`. Take `models.discover.advisory_session` (recommended: `opus high` — this phase needs creative depth). If current session doesn't match, advise once:

```
discover phase benefits from deeper thinking. Recommended: {advisory_session}.
Switch with /model opus and re-run /compass:discover, or continue on the current model.
```

Then proceed regardless.

## Pre-flight

Locate the current cycle (most recent `.compass-cycles/<cid>/` with state.json showing `lane: "compass"`, `phase: "intake"`, `status: "ok"`).

Read state.json. Update `phase` to `"discover"` immediately to reflect current work:

```jsonc
{ ..., "phase": "discover", "status": "ok", "next": "decide" }
```

Read `.compass-cycles/<cycle_id>/context.md` — this is your background bundle.

## Steps

### 1. AGENTS.md injection (mode != fresh)

If state.mode is `extend` or `light`:

```bash
find . -name AGENTS.md -not -path './.compass-cycles/*' -not -path './.forge-worktrees/*' -not -path './node_modules/*'
```

Read all matches. Treat AGENTS.md as **descriptive context** ("current rules at decision time"), not as binding constraints — compass discussions may decide to *change* AGENTS.md as a status-changing conclusion. Surface conflicts explicitly when they arise.

### 2. Resolve the discover skill

Read `~/.claude/commands/compass/skills.json`. Take `skills.discover` (default: `superpowers:brainstorming`).

### 3. Invoke the discover skill

Use the Skill tool to invoke the resolved skill. Constraints:

- **Save the discussion summary to `.compass-cycles/<cycle_id>/discovery.md`** — NOT the skill's default location of `docs/superpowers/specs/...`. The discovery doc is cycle-local.
- **Product-flavored prompt**: focus on
  - Problem space: what user pain does this address?
  - Target user: who specifically?
  - Why now: what changed?
  - In/out scope: bound the idea
  - For mode=extend: how does this relate to STATUS.md? extends a section, contradicts a Hard No, changes positioning?
- **Read-source-on-demand authorization**: if confirming an implementation detail would help give a sensible recommendation (e.g., "what's the current backbone structure"), use Read / Glob / Grep on the relevant paths. But only read what you actually need — no full-repo scans.
- **Risks + assumptions**: explicitly call out what's a guess vs. verified.

### 4. Override the skill's terminal action

The brainstorming skill normally:
- Writes spec to `docs/superpowers/specs/...`
- Invokes the writing-plans skill at the end

OVERRIDE both:
- Save to `.compass-cycles/<cycle_id>/discovery.md` (already noted above).
- Do NOT invoke writing-plans. The compass plan phase is structurally different — there's no "implementation plan" stage in compass. After discovery.md is committed-ready, fall through to step 5 below.

### 5. Update state.json

Overwrite:

```jsonc
{
  ...,
  "phase": "discover",
  "status": "needs-review",
  "next": "decide",
  "gate": {
    "kind": "discover-review",
    "artifact": ".compass-cycles/<cycle_id>/discovery.md",
    "approve_cmd": "/compass:approve"
  },
  "history": [<existing>, { "phase": "discover", "status": "needs-review", "at": "<now>" }]
}
```

### 6. Self-chain tail

`status == "needs-review"` → PushNotification:
```
{cycle_id}: discover-review ready, run /compass:approve
```
Let the turn end.

## Blocker handling

If brainstorming cannot converge (user rejects multiple approaches without proposing direction, or the idea remains too vague after several iterations):

1. Write `.compass-cycles/<cid>/blocker.md` explaining what was tried.
2. Update state to `blocked`.
3. PushNotification + stop.
