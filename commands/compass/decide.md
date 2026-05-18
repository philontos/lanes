# /compass:decide — classify discovery conclusions, draft artifacts

You are running the **decide phase**. Read `~/.claude/commands/PROTOCOL.md` first.

## Model advisory check

Read `~/.claude/commands/compass/skills.json`. Take `models.decide.advisory_session` (recommended: `opus med`). Advise once if current session doesn't match, then proceed.

## Pre-flight

Locate the current cycle. Read state.json. Confirm `phase == "discover"` and `status == "ok"`. Update `phase` to `"decide"`:

```jsonc
{ ..., "phase": "decide", "status": "ok", "next": "materialize" }
```

Read `.compass-cycles/<cycle_id>/discovery.md`.

## Steps

### 1. Extract conclusions

Identify every distinct conclusion in discovery.md. Each conclusion must be:
- A user-perspective statement (1 sentence)
- Not an implementation detail

If you can't extract any concrete conclusions, the discover phase didn't converge well enough — see Blocker handling.

### 2. Classify each conclusion

Apply these three rules in **OR** relationship — any single hit upgrades the conclusion to `status-changing`:

**Rule 1**: Does it change a specific line/section in STATUS.md?
- Yes (you can point to "this section needs editing") → status-changing
- No (STATUS.md untouched) → tactical

**Rule 2**: Does it change "what the project is" or "what it refuses to do"?
- Yes (new Hard No, positioning shift, target user change) → status-changing
- No (impl detail, bug fix, prompt tuning) → tactical

**Rule 3**: Worth looking back at in 6 months?
- Yes (a substantive decision that matters historically) → status-changing
- No (forget-and-move-on) → tactical

**Calibration examples** (for your reference; do NOT include in output):

```
"Add dimension X to backbone preset"   → status-changing (changes what project includes)
"Dimension X prompt in second person"   → tactical (impl detail)
"Add French i18n translation"           → tactical
"Reject Spanish translation, no users"  → status-changing (new Hard No)
"Switch vector search to hnsw index"    → tactical (impl)
"Local-first → local + optional cloud"  → status-changing (positioning shift)
```

### 3. Write decisions.md

Path: `.compass-cycles/<cycle_id>/decisions.md`

Format:

```markdown
# Cycle decisions — <cycle_id>

## Tactical

- <one-line statement> 
  goal: <why — 1 sentence>
  scope: in: <...>; out: <...>
  relevant_code: <comma-separated paths from discovery, or 'unknown'>

## Status-changing

- <one-line statement>
  STATUS.md edit: <which section, what change — be specific enough to apply mechanically>
  ADR title: <kebab-case slug>
  ADR body draft:
    上下文: <2-3 sentences from discovery.md>
    决策: <one-line conclusion>
    当时的理由: <2-3 sentences from discovery.md>
  implementation work (optional): <if there's code work for this status change, describe>
```

For each status-changing item, draft both the STATUS.md edit instruction AND the ADR body NOW (don't defer to materialize) — this gives the user a chance to refine before commits land.

### 4. Update state.json

```jsonc
{
  ...,
  "phase": "decide",
  "status": "needs-review",
  "next": "materialize",
  "gate": {
    "kind": "decide-review",
    "artifact": ".compass-cycles/<cycle_id>/decisions.md",
    "approve_cmd": "/compass:approve"
  },
  "history": [<existing>, { "phase": "decide", "status": "needs-review", "at": "<now>" }]
}
```

### 5. Self-chain tail

`status == "needs-review"` → PushNotification:
```
{cycle_id}: decide-review ready, run /compass:approve
```
Let the turn end.

**Note for the user (mention in PushNotification or in the final assistant message before stopping)**: "You can edit decisions.md directly before approving — rearrange items between Tactical and Status-changing, delete, add new ones. /compass:approve will commit whatever decisions.md says at approve time."

## Blocker handling

If discovery.md is too vague to extract actionable conclusions:

1. Write `.compass-cycles/<cid>/blocker.md` listing what's missing.
2. Update state to `blocked` with reason: "discovery too vague to classify".
3. Suggested resolution: user refines discovery.md manually then re-runs `/compass:decide`, OR aborts the cycle.
4. PushNotification + stop.
