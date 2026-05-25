# lanes

Autonomous development lanes for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You give a free-text request; lanes runs Claude headless inside a Docker container, driving it through a lane (a fixed sequence of phases) until it produces an artifact. The actual work each phase does comes from the [superpowers](https://github.com/obra/superpowers) skills (brainstorming, writing-plans, TDD, verification, code-review, …); the lane is thin orchestration that glues those skills into a self-driving pipeline.

One command, from any project:

```bash
lanes "build a 0→1 MVP for a CLI task tracker"
```

## How it works

1. `lanes "<request>"` (or `./run.sh "<request>"` from this repo) writes a `.lane/state.json` describing the request and the target lane/phase.
2. It launches the SDK orchestrator (`sdk/src/run.ts`) inside the `lanes-sdk-orchestrator` Docker image. The container mounts your superpowers plugin and the repo's `commands/` lane definitions.
3. The orchestrator runs one Claude Agent SDK session per phase. Tool calls are gated by an operator policy (`sdk/src/canUseTool.ts`); there is no human in the loop — when a skill needs a decision it is answered automatically.
4. Activity streams to your terminal live (assistant output, tool calls, truncated results). Each phase writes its artifact under `.lane/` (`spec.md`, `plan.md`, `review.md`); `impl` writes code changes into the working directory.

Auth runs through a long-lived OAuth token (macOS Keychain isn't reachable from inside the container), set up once by `./setup.sh` and stored at `~/.config/lanes/oauth-token`.

## The lanes

A lane is a named phase sequence. Lane definitions live in `commands/` and are read at runtime:

- **forge** — turn an ambiguous feature request into shippable work: `spec → plan → impl → review → ship`.
- **sprint** — fast lane for an already well-defined item: `impl → ship`.
- **compass** — turn a fuzzy product idea into backlog items: `intake → discover → decide → materialize`.

Each lane's `skills.json` maps a logical role (e.g. `spec`, `impl`) to a concrete superpowers skill, so you can swap the skill behind a phase without touching the orchestrator.

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
4. Build the `lanes-sdk-orchestrator:latest` Docker image.

Re-running is safe: an existing token is reused (delete the file to redo), and the image is rebuilt.

## Run

`./setup.sh` installs a `lanes` command on your PATH. From any project:

```bash
cd ~/your/project
lanes "build a 0→1 MVP that …"     # or a big refactor / a set of key features
```

`lanes "<request>"` defaults the worktree to the current directory; the chain
`spec → plan → impl → review` runs unattended (the operator judge auto-answers any
prompts per `principles.md` (the operator policy file)), streaming a live activity log. Artifacts land in
`.lane/` (`spec.md`, `plan.md`, `review.md`) and code changes land directly in the
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

- `ship` phase: real git worktree + branch + PR/MR per cycle.
- Human checkpoints: pause after `spec`/`plan` for approval, then resume.
- Externalize phase prompts into the mounted `commands/forge/*.md` (no image rebuild to tweak).
- Wire the sprint and compass lanes into auto mode.
- Failure recovery (`status: blocked`), retries, multi-cycle scheduling, cross-cycle memory.
