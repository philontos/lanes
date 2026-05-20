# /sprint:review — independent code review by a fresh subagent (sprint variant)

You are running the **review phase** of a sprint cycle. Read `~/.claude/commands/PROTOCOL.md` first.

Sprint review differs from forge review only in the context bundle: there is no `.lane/spec.md` to reference, so the reviewer sees the backlog bullet (or freeform request) as the "what this cycle was supposed to deliver" input. Everything else — verdict format, routing, blocker semantics — is identical.

## Model advisory check

Read `~/.claude/commands/sprint/skills.json`. Take `models.review.advisory_session` (recommended: `opus high` — reviewer judgment matters). If current session doesn't match, advise once. Note: the reviewer subagent dispatched below uses `models.review.subagent` (typically `opus`) regardless of session model.

## Pre-flight

Read `.lane/state.json`. Confirm `phase` is `impl` and `status == "ok"`. Update `phase` to `"review"`.

## Steps

### 1. Build the reviewer context bundle

Collect into a single string:

- **What the cycle was supposed to deliver** — assembled from `state`:
  - If `state.backlog_bullet` is non-null: the bullet's `raw` (full original block) plus an explicit note that `goal`/`scope`/`relevant_code` are the binding criteria.
  - If null (freeform): just `state.request` and a note that no structured spec exists — judgment must be against the request text alone.
- The full diff against `main`: `git diff main...HEAD`.
- All AGENTS.md files in the worktree (per PROTOCOL.md AGENTS.md injection rules).

### 2. Dispatch reviewer subagent

Read `~/.claude/commands/sprint/skills.json` and take `models.review.subagent` as `SUBAGENT_MODEL` (default: `opus`).

Use the Agent tool with `subagent_type=general-purpose` AND `model: SUBAGENT_MODEL`. The subagent gets ONLY the context bundle from Step 1 — NOT the conversation transcript (so it reviews against the bullet/request, not against what impl thought it was doing).

Reviewer prompt (verbatim):

> You are an independent code reviewer for a **sprint-lane** cycle — a lightweight pipeline that skipped formal spec and plan phases. Your inputs:
> 1. The backlog bullet (or freeform request) that defines what this cycle is supposed to deliver.
> 2. A git diff representing the proposed implementation.
> 3. The repo's AGENTS.md hard rules.
>
> Because there is no formal spec, judge **whether the diff plausibly satisfies the bullet's `goal` and stays within its `scope`** (or, for freeform requests, satisfies the request text and stays minimal).
>
> Classify every concern as **MUST-FIX** or **NICE-TO-HAVE**:
> - **MUST-FIX**: bullet goal not addressed; scope visibly violated; AGENTS.md rule broken; obvious bug; tests missing for a non-trivial change; security/data hazard.
> - **NICE-TO-HAVE**: style improvements, refactors, optional polish, ideas for follow-up.
>
> Sprint cycles intentionally trade depth for speed. Be calibrated: don't demand spec-level rigor that sprint deliberately skipped, but do flag anything a human reviewing the PR on GitHub would reasonably reject.
>
> Output format (markdown):
>
> ```
> ## Verdict: PASS | FAIL
> (PASS means zero MUST-FIX items.)
>
> ## MUST-FIX
> - <one item per line; cite file:line>
>
> ## NICE-TO-HAVE
> - <one item per line>
> ```
>
> Be terse. No preamble. No "great work overall". Just the verdict and the lists.
>
> CONTEXT BUNDLE follows.
> <paste bullet raw or request>
> <paste git diff>
> <paste AGENTS.md content>

### 3. Save reviewer output

Write the subagent's raw output to `.lane/review.md`.

### 4. Outcome routing

Parse the first `## Verdict:` line.

**Verdict PASS:**

Update state.json:
```jsonc
{ ..., "phase": "review", "status": "ok", "next": "ship",
  "history": [<existing>, { "phase": "review", "status": "ok", "at": "<now>" }] }
```
Self-chain to `~/.claude/commands/sprint/ship.md`.

**Verdict FAIL:**

Treat as blocker (do NOT auto-retry impl — sprint deliberately leaves recovery to the human):

1. Write `.lane/blocker.md` summarizing the MUST-FIX list and how to address it.
2. Update state.json:
   ```jsonc
   { ..., "phase": "review", "status": "blocked",
     "blocker": { "phase": "review", "reason": "reviewer found MUST-FIX items: <count>",
                  "last_action": "ran reviewer subagent",
                  "transcript": ".lane/review.md" },
     "history": [<existing>, { "phase": "review", "status": "blocked", "at": "<now>" }] }
   ```
3. PushNotification + stop. The user fixes the MUST-FIX items (typically by editing the worktree directly and re-running `/sprint:review`, or by promoting the cycle's residual work to a fresh `/forge` cycle if the bullet was the wrong fit).
