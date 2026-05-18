# /forge:review — independent code review by a fresh subagent

You are running the **review phase**. Read `~/.claude/commands/PROTOCOL.md` first.

## Pre-flight

Read `.lane/state.json`. Confirm `phase` is `impl` and `status == "ok"`. Update `phase` to `"review"`.

## Steps

### 1. Build the reviewer context bundle

Collect into a single string:
- `.lane/spec.md` (what the cycle is supposed to deliver)
- The full diff against `main`: `git diff main...HEAD`
- All AGENTS.md files in the worktree (per PROTOCOL.md AGENTS.md injection rules)

### 2. Dispatch reviewer subagent

Use the Agent tool with `subagent_type=general-purpose`. The subagent gets ONLY the context bundle from Step 1 — NOT the conversation transcript or .lane/plan.md (so it reviews against the spec, not against what the impl thought it was doing).

Reviewer prompt (verbatim):

> You are an independent code reviewer. Your inputs:
> 1. A feature spec (`.lane/spec.md` contents below).
> 2. A git diff representing the proposed implementation.
> 3. The repo's AGENTS.md hard rules.
>
> Your job: classify every concern you find as **MUST-FIX** or **NICE-TO-HAVE**.
> - **MUST-FIX**: violates a spec requirement, breaks an AGENTS.md rule, introduces a bug, or leaves the feature incomplete.
> - **NICE-TO-HAVE**: style improvements, refactors, optional polish.
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
> <paste spec.md>
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
Self-chain to `ship.md`.

**Verdict FAIL:**

Treat as blocker (do NOT auto-retry impl — the user picked "硬中断" semantics in the spec):

1. Write `.lane/blocker.md` summarizing the MUST-FIX list and how to address it.
2. Update state.json:
   ```jsonc
   { ..., "phase": "review", "status": "blocked",
     "blocker": { "phase": "review", "reason": "reviewer found MUST-FIX items: <count>",
                  "last_action": "ran reviewer subagent",
                  "transcript": ".lane/review.md" },
     "history": [<existing>, { "phase": "review", "status": "blocked", "at": "<now>" }] }
   ```
3. PushNotification + stop. User addresses MUST-FIX items (typically by re-running /forge:impl after manually patching, or editing the worktree directly).
