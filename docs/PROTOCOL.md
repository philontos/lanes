# Lanes — Protocol & Principles

How auto mode runs, and the principles it runs by. For *what it is and how to use it*, see the root `README.md`; this doc is the contract + operating principles.

## Operating principles

- **Headless.** No human is in the loop. When a skill calls `AskUserQuestion`, the operator **judge** answers it automatically, deciding from `principles.md` (the operator decision rulebook). `principles.md` is the place to encode your default preferences/trade-offs.
- **Docker is the boundary.** Inside the container all tools are allowed (including `Bash`); there is no per-tool allowlist. The target worktree is mounted read-write, so the agent can change/delete files there — run against an isolated, git-tracked dir.
- **Outcome-first.** Bias to action and accept reasonable, reversible risk; only refuse deliberately destructive or pointlessly irreversible actions. (Encoded in `principles.md`.)
- **Config over code.** Per-phase model / skill(s) / `maxTurns` / `maxThinkingTokens` live in the root `lanes.config.json`, read at runtime — edits take effect on the next run, no rebuild. The chain order is fixed in code.
- **Thin orchestration.** The lane is glue; the real work is done by the [superpowers](https://github.com/obra/superpowers) skill each phase invokes. Swap a skill by editing `lanes.config.json`, never code.

## The lane

Auto runs one lane today — **forge** — as a fixed chain, each phase a separate Agent SDK session whose context starts fresh and reads the prior phase's artifacts from `.lane/`:

```
spec → plan → impl → review
```

- `spec` → `.lane/spec.md`   (goal, scope in/out, files to change, success criteria, risks)
- `plan` → `.lane/plan.md`   (bite-sized, testable steps)
- `impl` → code changes in the worktree (uses Bash to build/test)
- `review` → `.lane/review.md` (self-review against spec/plan; fixes issues found)

A phase that doesn't end in `success` (including hitting `maxTurns`) **stops the chain** with `status: blocked` — the next phase never runs on a half-finished artifact.

## `.lane/` artifacts

Everything a run produces lives in `<worktree>/.lane/`:

| File | What |
|------|------|
| `state.json` | the cycle's durable record (schema below) |
| `spec.md` / `plan.md` / `review.md` | per-phase outputs |
| `run.log` | full activity stream (tee'd from the run) |
| `decision-log.md` | every `[ask]` the judge auto-answered |

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

Invariants:

1. Consumers branch on **`status`** only (4 values).
2. `next` is the next phase name, or `null` when `done`.
3. `history` is append-only and observation-only — never branch on it.
4. State writes are **whole-file overwrites**; the JSON must always be valid.

## AGENTS.md

If the target worktree has an `AGENTS.md`, its contents are injected into every phase prompt as **hard constraints**. It is the place for project-specific build rules (stack, structure, do-not-touch). `principles.md` (decision rulebook) and `AGENTS.md` (per-project constraints) are different things; on conflict, `AGENTS.md` wins.

## Not yet wired (see README Roadmap)

The `ship` phase (branch + PR/MR), human checkpoints (pause/resume after a phase), and the `sprint` / `compass` lanes are future work — only forge's `spec → plan → impl → review` runs today.
