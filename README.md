# lanes

Autonomous development lanes for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You give a free-text request; lanes runs Claude headless inside a Docker container, driving it through a lane (a fixed sequence of phases) until it produces an artifact. The actual work each phase does comes from the [superpowers](https://github.com/obra/superpowers) skills (brainstorming, writing-plans, TDD, verification, code-review, …); the lane is thin orchestration that glues those skills into a self-driving pipeline.

One command:

```bash
./run.sh "add a /healthz endpoint returning 200 OK"
```

## How it works

1. `./run.sh "<request>"` writes a `.lane/state.json` describing the request and the target lane/phase.
2. It launches the SDK orchestrator (`sdk/src/run.ts`) inside the `lanes-sdk-orchestrator` Docker image. The container mounts your superpowers plugin and the repo's `commands/` lane definitions.
3. The orchestrator runs a Claude Agent SDK session for the phase. Tool calls are gated by an operator policy (`sdk/src/canUseTool.ts`); there is no human in the loop — when a skill needs a decision it is answered automatically.
4. Activity streams to your terminal live (assistant output, tool calls, truncated results). The phase writes its artifact under `.lane/` (currently `.lane/spec.md`).

Auth runs through a long-lived OAuth token (macOS Keychain isn't reachable from inside the container), set up once by `./setup.sh` and stored at `~/.config/lanes/oauth-token`.

## The lanes

A lane is a named phase sequence. Lane definitions live in `commands/` and are read at runtime:

- **forge** — turn an ambiguous feature request into shippable work: `spec → plan → impl → review → ship`.
- **sprint** — fast lane for an already well-defined item: `impl → ship`.
- **compass** — turn a fuzzy product idea into backlog items: `intake → discover → decide → materialize`.

Each lane's `skills.json` maps a logical role (e.g. `spec`, `impl`) to a concrete superpowers skill, so you can swap the skill behind a phase without touching the orchestrator.

> Auto mode currently drives **forge's `spec` phase**. The other forge phases and the sprint/compass lanes exist as definitions but are not yet wired into the orchestrator — see [Roadmap](#roadmap).

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
4. Build the `lanes-sdk-orchestrator:latest` Docker image.

Re-running is safe: an existing token is reused (delete the file to redo), and the image is rebuilt.

## Run

```bash
./run.sh "<your request>"
```

Without a second argument, a temporary scratch worktree is created (good for trying things out). Pass a directory to run against an existing worktree:

```bash
./run.sh "refactor the auth module" ~/worktrees/my-feature
```

The run streams a live activity log, then prints the produced `.lane/spec.md` and the worktree path.

## Layout

```
setup.sh        one-time setup       (forwards to sdk/docker/setup.sh)
run.sh          run a cycle          (forwards to sdk/docker/run-auto.sh)
principles.md   operator policy injected into the orchestrator
commands/       lane definitions (forge/sprint/compass), mounted into the container
  PROTOCOL.md   shared contract: state.json, phase chaining, AGENTS.md injection
  <lane>.md     bootstrap for the lane
  <lane>/       skills.json + one file per phase
sdk/            the auto-mode engine
  src/          orchestrator, phase model, tool-permission policy, stream logger
  docker/       Dockerfile + setup.sh + run-auto.sh + lanes-docker.sh launcher
  test/         vitest unit tests
```

## Swapping a skill

To point a phase at a different skill, edit the lane's `skills.json`:

```json
{
  "skills": {
    "spec": "your-plugin:your-spec-skill"
  }
}
```

Phase logic looks up by logical role, so nothing else needs editing. The orchestrator reads `commands/<lane>/skills.json` from the mounted repo, so edits take effect on the next `./run.sh`.

## Roadmap

- Wire the remaining forge phases (`plan → impl → review → ship`) into the orchestrator.
- Wire the sprint and compass lanes into auto mode.
- Real git worktree + branch + PR/MR integration per cycle.
- Failure handling (`status: blocked`), resume entrypoints, retries.
- Multi-cycle scheduling and cross-cycle memory.
