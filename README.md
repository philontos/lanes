# lanes

Autonomous development lanes for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You give a free-text request; lanes runs Claude headless inside a Docker container, driving it through a lane (a fixed sequence of phases) until it produces an artifact. The actual work each phase does comes from the [superpowers](https://github.com/obra/superpowers) skills (brainstorming, writing-plans, TDD, verification, code-review, …); the lane is thin orchestration that glues those skills into a self-driving pipeline.

One command, from any project:

```bash
lanes "build a 0→1 MVP for a CLI task tracker"
```

## How it works

1. `lanes "<request>"` (or `./run.sh "<request>"` from this repo) writes a `.lane/state.json` describing the request and the target lane/phase.
2. It launches the SDK orchestrator (`sdk/src/run.ts`) inside the `lanes-sdk-orchestrator` Docker image (which has the superpowers skills baked in). The container mounts only the repo (for `lanes.config.json` + `principles.md`) and the target worktree.
3. The orchestrator runs one Claude Agent SDK session per phase. Tool calls are gated by an operator policy (`sdk/src/canUseTool.ts`); there is no human in the loop — when a skill needs a decision it is answered automatically.
4. Activity streams to your terminal live (assistant output, tool calls, truncated results). Each run gets its own isolated dir, `.lane/cycles/<cycle-id>/`, where each phase writes its artifact (`spec.md`, `plan.md`, `review.md`); `impl` writes code changes into the working directory.

Auth runs through a long-lived OAuth token (macOS Keychain isn't reachable from inside the container), set up once by `./setup.sh` and stored at `~/.config/lanes/oauth-token`.

## The lanes

A lane is a named phase sequence. Auto mode implements one lane today — **forge**:

- **forge** — turn a request into shippable work: `spec → plan → impl → review` (the `ship` phase, plus the `sprint` and `compass` lanes, are future work — see [Roadmap](#roadmap)).

Each phase's model, skill(s), and limits are configured per phase in `lanes.config.json` (see [Configure](#configure)), so you can swap the skill or model behind a phase without touching the orchestrator.

> Auto mode drives forge's `spec → plan → impl → review` chain. The `ship` phase
> (branch + PR/MR) and the sprint/compass lanes are not yet wired in — see
> [Roadmap](#roadmap).

## Prerequisites

| Dependency           | Severity | Notes                                                      |
|----------------------|----------|------------------------------------------------------------|
| Docker Desktop       | hard     | the orchestrator runs inside a Linux container             |
| Claude Code CLI      | hard     | `claude setup-token` issues the long-lived OAuth token     |
| Pro/Max subscription | hard     | required by `claude setup-token`                           |

## Setup (one-time)

```bash
git clone https://github.com/philontos/lanes.git ~/Develop/personal/lanes
cd ~/Develop/personal/lanes
./setup.sh
```

`./setup.sh` is the preflight/doctor for auto mode. It will:

1. Verify Docker is available, starting Docker Desktop if it isn't (auto-start is macOS-only; on Linux start the daemon yourself first).
2. Verify the `claude` CLI is on PATH.
3. Run `claude setup-token` for you and auto-capture the printed token (falling back to a manual paste prompt), saved to `~/.config/lanes/oauth-token` — outside the repo, never committed. A browser opens for you to approve the login.
4. Build the `lanes-sdk-orchestrator:latest` Docker image — this bakes the [superpowers](https://github.com/obra/superpowers) skills into the image, so runtime needs nothing from your host's Claude Code plugins.

Re-running is safe: an existing token is reused (delete the file to redo), and the image is rebuilt.

## Run

`./setup.sh` installs a `lanes` command on your PATH. From any project:

```bash
cd ~/your/project
lanes "build a 0→1 MVP that …"     # or a big refactor / a set of key features
```

`lanes "<request>"` defaults the worktree to the current directory; the chain
`spec → plan → impl → review` runs unattended — the operator judge auto-answers any
prompts per `principles.md` (the operator policy file) — streaming a live activity log. Artifacts land in
the run's own `.lane/cycles/<cycle-id>/` (`spec.md`, `plan.md`, `review.md`) and code changes land directly in the
working directory.

Pass an explicit directory to override the default:

```bash
lanes "refactor the auth module" ~/worktrees/my-feature
```

From inside this repo you can also use `./run.sh "<request>" [dir]`. Note the
default target differs: `lanes` uses your **current directory**, while bare
`./run.sh` (no dir) uses a throwaway **scratch** dir.

> Auto mode targets **large, structured work**. Quick one-off edits are better done
> directly in the interactive Claude Code CLI.
>
> Tools inside the container are fully open (including `Bash`) — Docker is the
> isolation boundary. The target directory is mounted read-write, so the agent can
> modify or delete files there.

## Layout

```
lanes.config.json  per-phase config: model / skill(s) / maxTurns / maxThinkingTokens
principles.md      operator decision rulebook for the judge (auto-answers prompts)
setup.sh           one-time setup       (forwards to sdk/docker/setup.sh)
run.sh             run a cycle          (forwards to sdk/docker/run-auto.sh)
sdk/               the auto-mode engine
  src/             orchestrator, phase model, tool-permission policy, stream logger
  docker/          Dockerfile + setup.sh + run-auto.sh + lanes-docker.sh launcher
  test/            vitest unit tests
docs/PROTOCOL.md   reference: the .lane/state.json contract
```

## Configure

Everything tunable lives in **`lanes.config.json`** — one entry per forge phase:

```json
{
  "phases": {
    "spec":   { "model": "opus",   "skill": "superpowers:brainstorming", "maxTurns": null, "maxThinkingTokens": null },
    "impl":   { "model": "sonnet", "skills": ["superpowers:executing-plans", "superpowers:test-driven-development"], "maxTurns": null, "maxThinkingTokens": null },
    "review": { "model": "opus",   "skill": null, "maxTurns": null, "maxThinkingTokens": null }
  }
}
```

- `model`: `opus` | `sonnet` | `haiku`.
- `skill` (single) or `skills` (array): the superpowers skill(s) the phase uses; `null`/absent on `review` = built-in self-review.
- `maxTurns` / `maxThinkingTokens`: `null` = no limit; a positive integer caps the phase (runaway/cost guard).

It's read at runtime from the mounted repo, so edits take effect on the next `lanes` run — no image rebuild. The chain order (`spec → plan → impl → review`) is fixed in code.

## Roadmap

- `ship` phase: real git worktree + branch + PR/MR per cycle.
- Human checkpoints: pause after `spec`/`plan` for approval, then resume.
- Wire the sprint and compass lanes into auto mode.
- Failure recovery (`status: blocked`), retries, multi-cycle scheduling, cross-cycle memory.
