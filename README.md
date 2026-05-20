# lanes

Autonomous development & product-discussion lanes for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Three slash-command pipelines that relay through a shared `state.json` contract; the [superpowers](https://github.com/obra/superpowers) skills (brainstorming, writing-plans, executing-plans, TDD, verification, code-review, ship) do the actual work per phase. The lanes are thin orchestration — they don't reinvent how to write specs, plans, code, or tests; they glue those skills into self-driving pipelines.

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
impl ─→ review ─→ ship ─→ done
```

- Same worktree model as forge, just under `.sprint-worktrees/<cycle_id>/` + `sprint/<cycle_id>` branch.
- **No spec, no plan, zero mid-cycle human gates** — the only human review is the GitHub PR / GitLab MR itself.
- Uses the backlog bullet's structured metadata (`goal`/`scope`/`relevant_code`) as the de-facto plan; missing metadata only fires a soft warning, doesn't block.
- Subagent review at the end catches obvious bugs / scope drift before opening the PR.
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

| Dependency  | Severity     | Notes                                                                |
|-------------|--------------|----------------------------------------------------------------------|
| Claude Code | hard         | the runtime hosting the slash commands                               |
| superpowers | hard         | provides every skill referenced in each lane's `skills.json`         |
| `git`       | hard         | bootstrap, impl, ship, compass materialize all use it                |
| `gh`        | hard for forge:ship | GitHub remotes — used to open the PR                          |
| `glab`      | hard for forge:ship | GitLab remotes — used to open the MR                          |
| `jq`        | soft         | speeds up state.json reads; Claude falls back to the Read tool       |

Install at least one of `gh` or `glab` matching the remotes you push to. Without either, forge:ship still pushes the branch but skips auto-opening the review request — the final notification will tell you to open it manually.

`install.sh` runs a dependency self-check and prints a per-item OK/MISS report with severities. To re-run just the check (e.g. after installing a missing dependency), use `./install.sh --check-only`.

## Install

First install [superpowers](https://github.com/obra/superpowers) in Claude Code — every skill referenced by the lanes comes from it:

```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Then clone lanes and run the installer:

```bash
git clone https://github.com/philontos/lanes.git ~/Develop/personal/lanes
cd ~/Develop/personal/lanes
./install.sh                  # default: symlink — repo updates propagate via 'git pull'
./install.sh --mode=copy      # alternative: copy files; re-run after 'git pull' to update
```

What `install.sh` does:
- Backs up any existing `~/.claude/commands/{PROTOCOL.md, forge.md, forge, compass.md, compass}` as `*.bak.<timestamp>`.
- Symlinks (or copies) the relevant paths from this repo into `~/.claude/commands/`.
- Reports prerequisite status.

## Update

Symlink install:
```bash
cd ~/Develop/personal/lanes && git pull
# done — next /forge or /compass invocation reads new content
```

Copy install:
```bash
cd ~/Develop/personal/lanes && git pull && ./install.sh --mode=copy
```

## Uninstall

```bash
cd ~/Develop/personal/lanes && ./uninstall.sh
```

Removes symlinks; preserves any `*.bak.<timestamp>` snapshots from earlier installs. Copy-mode installs are flagged with a warning so you can decide whether to delete.

## Use

### Forge — from inside any git repo with an `AGENTS.md`:

```
/forge <free-text feature request>
# or
/forge next                    # pop top bullet from <repo>/docs/lanes/backlog.md
```

Bootstrap will:
1. Create a worktree at `<repo>/.forge-worktrees/<cycle_id>/`
2. Add `.forge-worktrees/` to the repo's `.gitignore` if missing
3. Write the initial state.json
4. Self-chain into the spec phase

You'll get a PushNotification at each gate. After `/forge:approve`, the pipeline keeps going until either ship (success, PR/MR opened) or blocked (manual recovery).

### Sprint — same prerequisites as forge, lighter pipeline:

```
/sprint next                   # pop top bullet — preferred mode
# or
/sprint <free-text request>    # fires a soft warning, proceeds
```

Bootstrap will:
1. Create a worktree at `<repo>/.sprint-worktrees/<cycle_id>/`
2. Add `.sprint-worktrees/` to the repo's `.gitignore` if missing
3. Emit a soft warning if `goal` / `scope` / `relevant_code` are missing from the bullet (never blocks)
4. Self-chain straight into impl — no spec, no plan, no mid-cycle gates

You'll get exactly one PushNotification — when the PR/MR is opened (or when something blocks, which is the same recovery model as forge). The only human review happens on the PR itself.

### Compass — from anywhere (auto-detects context):

```
/compass <fuzzy product idea>
```

- In a repo with `docs/product/STATUS.md`: read STATUS as context, drive discovery, end with backlog items + optional STATUS edits + optional ADR archive in `docs/product/decisions/`.
- In an empty directory: ask whether to scaffold a new project (`~/Develop/personal/<name>/` with `docs/product/` skeleton + `git init`).
- In a git repo without `docs/product/`: discover-only; output lands in backlog.md only.

## Layout

```
commands/                            installed into ~/.claude/commands/
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
│   ├── review.md                    /sprint:review
│   └── ship.md                      /sprint:ship
├── compass.md                       /compass <idea>             (bootstrap; built in Phase 2)
└── compass/
    ├── skills.json                  logical-role → concrete-skill-name map (compass)
    ├── intake.md                    /compass:intake
    ├── discover.md                  /compass:discover
    ├── decide.md                    /compass:decide
    ├── materialize.md               /compass:materialize
    └── approve.md                   /compass:approve

install.sh                           install / re-install
uninstall.sh                         remove symlinks
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

Phase command files look up by logical role — no other file needs editing.

**Per-machine override** (so the override doesn't sync via git): `rm ~/.claude/commands/<lane>/skills.json` (breaks just this symlink) and replace with a local copy. Other commands stay synced.

## Status

Forge: main pipeline (spec → plan → impl → review → ship, two human gates, blocked-on-failure, GitHub + GitLab support). Implemented.

Sprint: lightweight pipeline (impl → review → ship, zero mid-cycle gates, soft-warning on missing bullet metadata). Implemented.

Compass: design complete; implementation pending.

Future (not yet): Stop hook safety net, `/forge:resume` / `/sprint:resume` / `/compass:resume`, automatic retries, multi-cycle parallel scheduling, cross-cycle memory.
