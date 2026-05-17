# harness

Autonomous development harness for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Six slash commands relay through a `state.json` contract; the [superpowers](https://github.com/<your-username>/superpowers) skills (brainstorming, writing-plans, executing-plans, TDD, verification, code-review, ship) do the actual work per phase. The harness is a thin orchestration layer — it doesn't reinvent how to write specs / plans / code / tests, it just glues those skills into a self-driving pipeline.

## How it works

```
/harness <req>  or  /harness next
        │
        ▼
spec ─→ [spec-review gate] ─→ plan ─→ [plan-review gate] ─→ impl ─→ review ─→ ship ─→ done
```

- One cycle == one `git worktree` under `.harness-worktrees/<cycle_id>/` + one `harness/<cycle_id>` branch + one final PR.
- Phase commands write their outcome to `.harness/state.json`; the next command reads it and self-chains.
- Two human gates: `spec-review` and `plan-review`. After each, run `/harness:approve` to resume.
- Failure → `status: blocked`, worktree preserved, notification fires, you take over.

## Prerequisites

| Dependency  | Severity     | Notes                                                                |
|-------------|--------------|----------------------------------------------------------------------|
| Claude Code | hard         | the runtime hosting the slash commands                               |
| superpowers | hard         | provides every skill referenced in `commands/harness/skills.json`     |
| `git`       | hard         | bootstrap, impl, ship all use it                                     |
| `gh`        | hard for ship | GitHub remotes — used by ship to open the PR                         |
| `glab`      | hard for ship | GitLab remotes — used by ship to open the MR                         |
| `jq`        | soft         | speeds up state.json reads; Claude falls back to the Read tool       |

Install at least one of `gh` or `glab` matching the remotes you push to. Without either, ship still pushes the branch but skips auto-opening the review request — the final notification will tell you to open it manually.

`install.sh` runs a dependency self-check and prints a per-item OK/MISS report with severities.

## Install

```bash
git clone <this-repo-url> ~/Develop/personal/harness
cd ~/Develop/personal/harness
./install.sh                  # default: symlink — repo updates propagate via 'git pull'
./install.sh --mode=copy      # alternative: copy files; re-run after 'git pull' to update
```

What `install.sh` does:
- Backs up any existing `~/.claude/commands/harness.md` and `~/.claude/commands/harness/` as `*.bak.<timestamp>`.
- Symlinks (or copies) the two paths from this repo into `~/.claude/commands/`.

## Update

Symlink install:
```bash
cd ~/Develop/personal/harness && git pull
# done — next /harness invocation reads new content
```

Copy install:
```bash
cd ~/Develop/personal/harness && git pull && ./install.sh --mode=copy
```

## Uninstall

```bash
cd ~/Develop/personal/harness && ./uninstall.sh
```

Removes symlinks; preserves any `*.bak.<timestamp>` snapshots from earlier installs. Copy-mode installs are flagged with a warning so you can decide whether to delete.

## Use

From inside any git repository that has an `AGENTS.md` file at its root:

```
/harness <free-text feature request>
# or
/harness next                  # pop top bullet from <repo>/docs/harness/backlog.md
```

The bootstrap will:
1. Create a worktree at `<repo>/.harness-worktrees/<cycle_id>/`
2. Add `.harness-worktrees/` to the repo's `.gitignore` if missing
3. Write the initial state.json
4. Self-chain into the spec phase

You'll get a PushNotification at each gate. After `/harness:approve`, the pipeline keeps going until either ship (success, PR opened) or blocked (manual recovery).

## Layout

```
commands/                      installed into ~/.claude/commands/
├── harness.md                 /harness <req> | /harness next  (bootstrap)
└── harness/
    ├── PROTOCOL.md            shared contract: state.json, self-chain, AGENTS.md injection
    ├── skills.json            logical-role → concrete-skill-name map
    ├── spec.md                /harness:spec     — discover the feature
    ├── plan.md                /harness:plan     — decompose into tasks
    ├── impl.md                /harness:impl     — execute + TDD + verify
    ├── review.md              /harness:review   — independent reviewer subagent
    ├── ship.md                /harness:ship     — push + open PR
    └── approve.md             /harness:approve  — flip a gate

install.sh                     install / re-install
uninstall.sh                   remove symlinks
```

## Swapping a skill

Want to point `discover` at a different brainstorming-style skill, or replace `verify` with your own? Edit `commands/harness/skills.json`:

```json
{
  "skills": {
    "discover":  "your-plugin:your-discovery-skill",
    ...
  }
}
```

Phase command files look up by logical role — no other file needs editing.

**Per-machine override** (so the override doesn't sync via git): `rm ~/.claude/commands/harness/skills.json` (breaks just this symlink) and replace with a local copy. Other commands stay synced.

## Status

Phase 1: main pipeline (spec → plan → impl → review → ship, two human gates, blocked-on-failure). Implemented.

Phase 2 (not yet): Stop hook safety net, `/harness:resume`, automatic retries, multi-cycle parallel scheduling, cross-cycle memory.
