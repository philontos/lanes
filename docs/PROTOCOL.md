# Lanes — Protocol & Principles

How auto mode runs, and the principles it runs by. For *what it is and how to use it*, see the root `README.md`; this doc is the contract + operating principles.

## Operating principles

- **Headless.** No human is in the loop. When a skill calls `AskUserQuestion`, the operator **judge** answers it automatically, deciding from `judge-principles.md` (the operator decision rulebook). `judge-principles.md` is the place to encode your default preferences/trade-offs.
- **Docker is the boundary.** Inside the container all tools are allowed (including `Bash`); there is no per-tool allowlist. The target worktree is mounted read-write, so the agent can change/delete files there — run against an isolated, git-tracked dir.
- **Outcome-first.** Bias to action and accept reasonable, reversible risk; only refuse deliberately destructive or pointlessly irreversible actions. (Encoded in `judge-principles.md`.)
- **Config over code.** Per-phase model / skill(s) / `maxTurns` / `maxThinkingTokens` live in the root `lanes.config.json`, read at runtime — edits take effect on the next run, no rebuild. The chain order is fixed in code.
- **Thin orchestration.** The lane is glue; the real work is done by the [superpowers](https://github.com/obra/superpowers) skill each phase invokes. Swap a skill by editing `lanes.config.json`, never code.

## The lane

Auto runs one lane today — **forge** — as a fixed chain, each phase a separate Agent SDK session whose context starts fresh and reads the prior phase's artifacts from `.lane/`:

```
spec → plan → impl → review
```

- `spec` → `.lane/…/spec.md`   (goal, scope in/out, files to change, success criteria, risks)
- `plan` → `.lane/…/plan.md`   (bite-sized, testable steps)
- `impl` → code changes in the worktree (uses Bash to build/test)
- `review` → `.lane/…/review.md` + `.lane/…/verdict.json` — an **independent** review (no code edits) that audits the diff against `engineering-rubric.md` and emits `{"verdict":"pass"|"reject","reasons":[...]}`

**The review gate.** A `pass` completes the cycle (`done`). A `reject` bounces back to `impl` with the reasons injected as feedback (status `needs-review`), re-runs `impl → review`, up to **2 retries**; if still rejected, the cycle stops `blocked` with the reasons under a `gate` field. A missing/unparseable `verdict.json` is treated as `pass` (lenient — the gate's teeth are explicit rejects, not read glitches).

A phase that doesn't end in `success` (including hitting `maxTurns`) **stops the chain** with `status: blocked` — the next phase never runs on a half-finished artifact. A phase that **throws** (SDK / network / auth error, judge crash, …) is treated the same way: it is recorded as `blocked` with the error in `history`, and the run exits non-zero — never left recorded as the `ok` written before the phase ran.

`engineering-rubric.md` (repo root, injected into review like `judge-principles.md` is into the judge) is the hand-authored bar for "best-practice vs. hack"; the operator owns it.

## `.lane/` layout — one isolated dir per cycle

A run never shares files with another cycle. Bootstrap creates a fresh dir up front and points `.lane/current-cycle` at it; everything the run produces lives inside that dir:

```
<worktree>/.lane/
  current-cycle                    one-line pointer: the active cycle id
  cycles/<cycle-id>/
    state.json                     the cycle's durable record (schema below)
    spec.md / plan.md / review.md  per-phase outputs
    verdict.json                   the review gate's machine-readable verdict
    run.log                        full activity stream (tee'd from the run)
    decision-log.md                every [ask] the judge auto-answered
```

The orchestrator resolves the active lane dir from `current-cycle` (and **fails loud** if it is missing). Past cycles stay untouched under `cycles/`, so artifacts are never overwritten, staled into, or mixed across cycles — isolation holds the moment the dir is created, with no archive/rotate step that might not run. `.lane/` is run bookkeeping, not a deliverable; add it to the target project's `.gitignore`.

## `state.json` contract

```jsonc
{
  "lane": "forge",
  "cycle_id": "cycle-<timestamp>",
  "request": "<original free-text request>",
  "autonomy": "auto",
  "phase":  "spec | plan | impl | review",
  "status": "ok | needs-review | blocked | done",
  "next":   "<next phase name>",   // null when status == done
  "history": [                     // append-only, observation-only
    { "phase": "spec", "status": "ok", "at": "<ISO-8601>" }
  ]
}
```

`status` values: `ok` (phase clear, advancing) · `needs-review` (review rejected; bouncing back to `impl` with feedback, `next: "impl"`) · `blocked` (failed/threw/hit maxTurns, or gate exhausted — see `gate`) · `done` (review passed, `next: null`).

Invariants:

1. Consumers branch on **`status`** only (4 values).
2. `next` is the next phase name, or `null` when `done`.
3. `history` is append-only and observation-only — never branch on it.
4. State writes are **whole-file overwrites**; the JSON must always be valid.

## AGENTS.md

If the target worktree has an `AGENTS.md`, its contents are injected into every phase prompt as **hard constraints**. It is the place for project-specific build rules (stack, structure, do-not-touch). `judge-principles.md` (decision rulebook) and `AGENTS.md` (per-project constraints) are different things; on conflict, `AGENTS.md` wins.

## Not yet wired (see README Roadmap)

The `ship` phase (branch + PR/MR), human checkpoints (pause/resume after a phase), and the `sprint` / `compass` lanes are future work — only forge's `spec → plan → impl → review` runs today.
