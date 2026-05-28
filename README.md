# lanes

A local project-state platform on top of [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Turn any repo into a five-layer model — *summary · spec · features · plan · backlog* — and let Claude maintain it for you on git branches you review and merge.

Three lanes, all driven from a local web:

- **init** — bootstrap `.lanes/` from existing code (scan + model what's already there)
- **reshape** — modify spec / features / plan per your intent (surgical edits, stable IDs)
- **forge** — execute a backlog item: `spec → plan → impl → review → reflect`, writes real code AND folds learning back into the upper layers

Every lane produces a proposal on a `lanes/<cycle-id>` branch. **`main` only changes when you merge** — Claude never touches your real state without your explicit approval.

**Strong consistency by construction.** Every cycle ends with a `reflect` step that updates `.lanes/*` to match what just happened (new features discovered, plan decisions made, scope clarifications, etc.) and writes a short `reflection.md` summarising the change. The project page's **Pulse** panel surfaces all of this — last activity, in-flight cycles, pending branches awaiting your merge, recent learnings, structural drift — so you can scan a project in five seconds even after a week away.

## Prerequisites

| Dependency | Why |
|---|---|
| Docker Desktop | the orchestrator runs inside Linux containers |
| Claude Code CLI | `claude setup-token` issues a long-lived OAuth token |
| Pro / Max subscription | required by `claude setup-token` |

## Setup (once)

```bash
git clone https://github.com/philontos/lanes.git ~/Develop/personal/lanes
cd ~/Develop/personal/lanes
./setup.sh
```

`./setup.sh` checks Docker, runs `claude setup-token` (opens your browser), builds the image, and installs a global `lanes` command at `~/.local/bin/lanes`.

## Use it

Everything happens through the web. **Start it:**

```bash
lanes web                # → http://localhost:7777
lanes web --port 8080    # custom port
```

That command starts a local container and opens an HTTP server. Workspace defaults to `~/lanes-workspace/`; override with `LANES_WORKSPACE=/some/path lanes web`.

Then in the browser:

### 1. Add a project

On the workspace page, paste a git URL and click **Import** — lanes clones it into the workspace.

### 2. Initialise it

The new card shows as **uninit**. Click **`[Init…]`**.

A modal opens with an optional textarea (constraints / focus hints, or leave it blank for pure auto-scan). Submit → an `init` cycle reads the codebase and writes `.lanes/{summary, spec, features, plan}` on a `lanes/<cycle-id>` branch.

You watch the live log stream. When it ends:

```bash
cd ~/lanes-workspace/<project>
git diff main lanes/cycle-xxxxx -- .lanes/    # review the proposal
git merge lanes/cycle-xxxxx                    # accept it (or discard the branch)
```

### 3. Drill into the project

Back in the web, click the project card. You see a **Pulse** panel at the top — last activity, in-flight cycles, pending branches, recent learnings, drift flags — then all five layers below:

- **Summary** — one paragraph cover
- **L1 Spec** — Goal / Scope IN / Scope OUT / Success / Open Questions / Constraints
- **L2 Features** — capability blocks with stable IDs + derived status
- **L3 Tech Plan** — stack + architecture + key decisions
- **L4 Backlog** — executable items, grouped by feature

Pulse gives you the "where is this project" scan in five seconds; the layers below give you the drill-down when you need it.

### 4. Iterate the docs — **`[Reshape…]`**

Top right of the project page. Modal asks: *what do you want to change?* Examples:

> "Add keyboard shortcuts as a feature."
> "Drop SSO; move it to Scope OUT with reason 'OIDC complexity'."
> "Split feature-0003 into read path and write path."

A `reshape` cycle makes minimal targeted edits to `.lanes/*` on a new branch. Stable IDs preserved, soft-delete only. Review the diff and merge as above.

### 5. Execute a backlog item — **`[Run]`**

Next to any `todo` or `blocked` item in the backlog. A `forge` cycle runs `spec → plan → impl → review → reflect`:

- the first four phases write code and pass it through the review gate;
- the `reflect` phase reads the diff and updates `.lanes/*` so the project model stays consistent with what was actually built — appending discovered backlog items, recording key decisions in `plan.md`, capturing implementation notes on the affected feature, flagging any tensions the cycle didn't resolve;
- a `reflection.md` summarising all of the above lands in the cycle dir.

Review the code diff *and* the doc updates *and* the reflection, then merge. One branch, one merge, atomic application.

### 6. Loop

Reshape when scope shifts; run when an item is ready. The 5-layer model on `main` stays in sync with the code because both move through the same branch-and-merge gate, and `reflect` plus the Pulse panel make sure nothing meaningful gets lost.

## What lives where

```
.lanes/
├── summary.md       L0  one paragraph cover
├── spec.md          L1  six fixed H2 sections (Goal, Scope IN/OUT, …)
├── features.json    L2  capability blocks — stable IDs, soft-delete via lifecycle
├── plan.md          L3  short global tech foundation
└── backlog.json     L4  items with stable IDs; forge writes status here
```

State is derived: `feature.display_status` comes from its items; project status from features. Nothing duplicated, nothing to drift.

## Configure (no rebuild)

| File | Purpose |
|---|---|
| [`lanes.config.json`](lanes.config.json) | per-phase model, skills, maxTurns — read at runtime |
| [`judge-principles.md`](judge-principles.md) | how the auto-judge answers `AskUserQuestion` |
| [`engineering-rubric.md`](engineering-rubric.md) | what the review gate audits the diff against |
| [`design-principles.md`](design-principles.md) | UI aesthetic bar (used by `forge` when UI work is involved) |
| `AGENTS.md` in your target repo | per-project hard constraints (injected as system context) |

Plugins (`docker/plugins.json`) are baked into the image at build time — change those + re-run `./setup.sh`.

## Layout

```
web/         the app — HTTP server, SSE, SPA, cycle spawn
sdk/         the lanes engine — orchestrator, phases, project-state primitives
docker/      Dockerfile + lanes-web.sh + run-auto.sh + plugins manifest
docs/        PROTOCOL.md (state.json contract) + design specs
```

For the architecture and the rationale behind the five-layer model, see [`docs/superpowers/specs/2026-05-28-lanes-platform-v1-design.md`](docs/superpowers/specs/2026-05-28-lanes-platform-v1-design.md). For the legacy CLI free-text entry (used by CI / scripts), see [`docker/README.md`](docker/README.md).

## Roadmap

- Real multi-turn chat (route `AskUserQuestion` to the web, pause/resume cycles)
- Inline editing of spec / features / plan from the web
- Branch picker (compare `main` vs in-flight proposals)
- Drift detection (code changed but `.lanes/*` didn't)
- Multi-cycle scheduling + cross-cycle memory
