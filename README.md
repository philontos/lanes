# lanes

Autonomous development & product-discussion lanes for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Three pipelines that relay through a shared `state.json` contract and run headless via auto mode — an SDK orchestrator driven inside a Docker container (`./setup.sh` once, then `./run.sh "<request>"`). The [superpowers](https://github.com/obra/superpowers) skills (brainstorming, writing-plans, executing-plans, TDD, verification, code-review, ship) do the actual work per phase. The lanes are thin orchestration — they don't reinvent how to write specs, plans, code, or tests; they glue those skills into self-driving pipelines.

## Three lanes

### `/forge` — turn an ambiguous feature request into a PR

```
/forge <req>  or  /forge next
        │
        ▼
spec ─→ [spec-review gate] ─→ plan ─→ [plan-review gate] ─→ impl ─→ review ─→ ship ─→ done
```

- One cycle == one `git worktree` under `.forge-worktrees/<cycle_id>/` + one `forge/<cycle_id>` branch + one final PR (or MR for GitLab).
- Two human gates: `spec-review`, `plan-review`. After each, run `/forge:approve` to resume.
- Failure → `status: blocked`, worktree preserved, notification fires, you take over.

### `/sprint` — fast lane: take a well-defined backlog item straight to PR

```
/sprint <req>  or  /sprint next
         │
         ▼
impl ─→ ship ─→ done
```

- Same worktree model as forge, just under `.sprint-worktrees/<cycle_id>/` + `sprint/<cycle_id>` branch.
- **No spec, no plan, no mid-cycle gates, no in-pipeline subagent reviewer.** Code review is delegated to the PR/MR itself — a human reviewer, or a tool like `/ultrareview` for parallel multi-agent review.
- Uses the backlog bullet's structured metadata (`goal`/`scope`/`relevant_code`) as the de-facto plan; missing metadata only fires a soft warning, doesn't block.
- Choose `/sprint` when the bullet is already well-defined (typically just out of `/compass:materialize`); choose `/forge` when the task is ambiguous enough to need its own spec/plan.

### `/compass` — turn a product idea into backlog items (and maybe an ADR)

```
/compass <idea>
        │
        ▼
intake ─→ discover ─→ [discover-review gate] ─→ decide ─→ [decide-review gate] ─→ materialize ─→ done
```

- Auto-detects mode: `fresh` (no git repo here yet), `light` (git repo but no `docs/product/`), `extend` (full setup).
- Reads only `docs/product/STATUS.md` for context — never reads existing ADRs as constraints.
- Writes `<repo>/docs/lanes/backlog.md` items + optionally STATUS.md edits + optionally ADR archives.

The three lanes meet at `<repo>/docs/lanes/backlog.md`: compass appends to `## Queued`; forge or sprint pops the top (both honor the same bullet format and move it through `## Dispatched` → `## Completed`).

## Prerequisites

| Dependency           | Severity | Notes                                                      |
|----------------------|----------|------------------------------------------------------------|
| Docker Desktop       | hard     | auto runs the orchestrator inside a Linux container        |
| Claude Code CLI      | hard     | `claude setup-token` issues the long-lived OAuth token     |
| Pro/Max subscription | hard     | required by `claude setup-token`                           |

`./setup.sh` verifies Docker + the `claude` CLI, starts Docker Desktop if it is
down, and obtains/saves the OAuth token for you. It is the preflight/doctor for
auto mode. (The Docker auto-start is macOS-only; on Linux start the Docker
daemon yourself before running.)

## Setup (one-time)

```bash
git clone https://github.com/philontos/lanes.git ~/Develop/personal/lanes
cd ~/Develop/personal/lanes
./setup.sh
```

`./setup.sh` will:
1. Verify Docker is available (and start Docker Desktop if it isn't).
2. Verify the `claude` CLI is on PATH.
3. Run `claude setup-token` for you and auto-capture the printed token
   (falling back to manual paste), saved to `~/.config/lanes/oauth-token`
   (outside the repo, never committed).
4. Build the `lanes-sdk-orchestrator:latest` Docker image.

## Run

```bash
./run.sh "add a /healthz endpoint returning 200 OK"
```

Optional second argument targets an existing worktree; without it a temporary
scratch directory is created:

```bash
./run.sh "refactor auth module" ~/worktrees/my-feature
```

The run streams a live, CLI-style activity log (assistant output, tool calls,
truncated tool results) to your terminal as it works, then prints the produced
`.lane/spec.md`.

> **Current capability:** the SDK orchestrator runs the **spec phase only**.
> The remaining forge phases (plan → impl → review → ship) are not yet wired
> into auto mode.

## Layout

```
commands/                            lane definitions (forge/sprint/compass); mounted into the container by auto mode
├── PROTOCOL.md                      shared contract: state.json, self-chain, AGENTS.md injection
├── forge.md                         /forge <req> | /forge next  (bootstrap)
├── forge/
│   ├── skills.json                  logical-role → concrete-skill-name map (forge)
│   ├── spec.md                      /forge:spec
│   ├── plan.md                      /forge:plan
│   ├── impl.md                      /forge:impl
│   ├── review.md                    /forge:review
│   ├── ship.md                      /forge:ship
│   └── approve.md                   /forge:approve
├── sprint.md                        /sprint <req> | /sprint next (bootstrap)
├── sprint/
│   ├── skills.json                  logical-role → concrete-skill-name map (sprint)
│   ├── impl.md                      /sprint:impl
│   └── ship.md                      /sprint:ship
├── compass.md                       /compass <idea>             (bootstrap; built in Phase 2)
└── compass/
    ├── skills.json                  logical-role → concrete-skill-name map (compass)
    ├── intake.md                    /compass:intake
    ├── discover.md                  /compass:discover
    ├── decide.md                    /compass:decide
    ├── materialize.md               /compass:materialize
    └── approve.md                   /compass:approve

setup.sh                             one-time auto-mode setup (forwards to sdk/docker/setup.sh)
run.sh                               run an auto cycle (forwards to sdk/docker/run-auto.sh)
sdk/                                 SDK orchestrator + Docker (auto mode engine)
```

## Swapping a skill

Want to point `discover` at a different brainstorming-style skill, or replace `verify` with your own? Edit the relevant lane's `skills.json`:

```json
{
  "skills": {
    "discover":  "your-plugin:your-discovery-skill",
    ...
  }
}
```

Phase command files look up by logical role — no other file needs editing. Auto mode reads `commands/<lane>/skills.json` directly from the repo (mounted into the container), so edits take effect on the next `./run.sh`.

## Status

The full lane logic lives in `commands/` — forge (spec → plan → impl → review → ship, two human gates, in-pipeline subagent review, blocked-on-failure semantics, GitHub + GitLab support), sprint (lightweight impl → ship), and compass (intake → discover → decide → materialize). That logic is complete as lane definitions.

Auto mode (the SDK orchestrator in `sdk/`) currently drives the **spec phase only**. The remaining forge phases (plan → impl → review → ship) and the sprint/compass lanes are not yet wired into the auto orchestrator.

Future (not yet): wire the non-spec phases and the sprint/compass lanes into auto mode, Stop hook safety net, resume entrypoints, automatic retries, multi-cycle parallel scheduling, cross-cycle memory.
