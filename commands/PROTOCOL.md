# Lanes — Shared Protocol

This file is referenced by every `/forge:*` and `/compass:*` command. Both lanes share the same `state.json` contract, self-chain mechanics, and AGENTS.md injection rules — they differ in phase set and storage location.

## Skill resolution

Every phase command that needs a skill must NOT hard-code the skill name. Instead:

1. Read the lane's own `skills.json`:
   - forge:   `~/.claude/commands/forge/skills.json`
   - compass: `~/.claude/commands/compass/skills.json`
2. Look up the skill name under `skills.<logical-role>` (e.g. `skills.discover`).
3. Pass that exact string to the Skill tool.

The `usage` object in each skills.json declares which logical roles each phase consumes — useful for a sanity scan but not load-bearing at runtime.

To swap a skill (e.g. point `discover` at a different brainstorming-style skill), edit the relevant lane's `skills.json` only — never edit phase command files for that reason.

## Model resolution

Each lane's `skills.json` carries a `models` map alongside `skills`:

```json
"models": {
  "<phase>": {
    "subagent":         "opus | sonnet | haiku",
    "advisory_session": "opus high | sonnet med | haiku low | ..."
  }
}
```

Phase commands use it two ways:

**1. Subagent dispatch (strict):** when a phase command invokes the Agent tool to spawn a subagent (e.g. forge `impl` for parallel work, forge `review` for the independent reviewer), the command reads `models.<phase>.subagent` and passes it as the Agent tool's `model` parameter. This binds the subagent's family deterministically.

**2. Session advisory (informational):** at the top of every phase command, before doing any real work, the command reads `models.<phase>.advisory_session` and compares to the current session's model+effort. On mismatch, it emits **one** assistant message recommending a switch (`/model opus high`), then proceeds regardless. Users are not forced — the advisory is informational. Phase commands cannot programmatically change session model in Claude Code today.

To change a phase's recommended model, edit the relevant `skills.json` only — never the phase command files. Adjusting `subagent` takes effect on the next dispatch; adjusting `advisory_session` takes effect on the next phase invocation.

## state.json schema

Shared by both lanes. Location differs:

- forge cycle:   `<repo>/.forge-worktrees/<cycle_id>/.lane/state.json`
- compass cycle: `<repo>/.compass-cycles/<cycle_id>/state.json`

```jsonc
{
  "lane": "forge | compass",                           // which lane is running this cycle
  "cycle_id": "2026-05-18-<kebab-slug>",
  "repo": "<basename of repo root>",
  "request": "<original free-text request>",

  // phase enum depends on lane:
  //   forge:   spec | plan | impl | review | ship | done
  //   compass: intake | discover | decide | materialize | done
  "phase": "<phase name>",

  "status": "ok | needs-review | blocked | done",
  "next":   "<next phase name>",   // null when status == done

  "gate": {                        // present only when status == needs-review
    "kind":        "<gate name, e.g. spec-review or discover-review>",
    "artifact":    "<relative path to file the human should review>",
    "approve_cmd": "/forge:approve"   // or /compass:approve
  },

  "blocker": {                     // present only when status == blocked
    "phase":       "<phase name>",
    "reason":      "<one-liner>",
    "last_action": "<one-liner>",
    "transcript":  "<relative path to .log file>"
  },

  "history": [                     // append-only; consumers MUST NOT use for decisions
    { "phase": "spec", "status": "ok", "at": "2026-05-18T10:01:33Z" }
  ]
}
```

### Invariants

1. `status` only takes one of 4 values; every consumer branches on `status` alone.
2. `next` must be a phase name valid for the current lane, or null. Phase command files are looked up as `~/.claude/commands/<lane>/${next}.md`.
3. `gate.approve_cmd` is the literal `/<lane>:approve` — humans should never have to remember which command to type.
4. `history` is observation-only; hooks and commands never branch on it.
5. State updates are **whole-file overwrites**. Never append fragments; the JSON must always be valid.

## Self-chain tail

Every phase command, after its main work, MUST execute this tail:

```
1. Use Bash + jq to read .state.json's status and next fields.
2. Append the just-finished phase to `history` with the current ISO-8601 timestamp.
3. Branch:
   a) status == "ok" and next is non-empty:
      Read ~/.claude/commands/<lane>/${next}.md in full and execute it
      as the next instruction. Do NOT end this turn — chain into the
      next phase immediately.
   b) status == "needs-review":
      Call PushNotification with:
        "{cycle_id}: {gate.kind} ready, run {gate.approve_cmd}"
      Let this turn end naturally.
   c) status == "blocked":
      Verify blocker.md is written (reason + last_action + suggested
      human entry point). Call PushNotification with:
        "{cycle_id}: blocked at {blocker.phase}: {blocker.reason}"
      Let this turn end naturally.
   d) status == "done":
      Call PushNotification with a lane-specific terminal message
      (see each lane's ship/materialize command for the exact format).
      Let this turn end naturally.
```

## AGENTS.md injection

Forge `spec` and `review` phases, and compass `discover` and `decide` phases, MUST read every `AGENTS.md` file in the active repo:

```bash
# from the worktree (forge) or repo root (compass)
find . -name AGENTS.md -not -path './.forge-worktrees/*' -not -path './.compass-cycles/*' -print
```

Concatenate the contents and inject as hard-constraint context for the skill invocation.

For compass, AGENTS.md is **descriptive** (current rules at decision time) not **constraining** in the same way — compass discussions can decide to *change* AGENTS.md as a status-changing conclusion. But the discover phase must surface the conflict explicitly before deciding.

## .gitignore injection

forge bootstrap checks `<repo>/.gitignore` for `.forge-worktrees/`:

```
# lanes — forge worktrees
.forge-worktrees/
```

compass bootstrap (on first run in a repo) checks for `.compass-cycles/`:

```
# lanes — compass cycle scratch
.compass-cycles/
```

If either entry is missing, the bootstrap appends it and commits with message `chore(lanes): ignore <pattern>`. This commit is made on the active branch (forge does this from main before creating the worktree; compass does it from main since it has no worktree).

## cycle_id naming

Format: `YYYY-MM-DD-<kebab-slug>`. Slug = 3-6 keywords from the request, ASCII, lowercase, hyphen-separated. On collision, append `-2`, `-3`, etc.

## File-location convention

### Forge (uses git worktree)

| File                          | Path                                                      |
|-------------------------------|-----------------------------------------------------------|
| worktree root                 | `<repo>/.forge-worktrees/<cycle_id>/`                     |
| state.json                    | `<worktree>/.lane/state.json`                             |
| spec.md                       | `<worktree>/.lane/spec.md`                                |
| plan.md                       | `<worktree>/.lane/plan.md`                                |
| review.md                     | `<worktree>/.lane/review.md`                              |
| blocker.md (when blocked)     | `<worktree>/.lane/blocker.md`                             |
| per-phase transcript          | `<worktree>/.lane/transcript/<phase>.log`                 |
| branch                        | `forge/<cycle_id>`                                        |

### Compass (no worktree; direct on main)

| File                          | Path                                                      |
|-------------------------------|-----------------------------------------------------------|
| cycle scratch dir             | `<repo>/.compass-cycles/<cycle_id>/`                      |
| state.json                    | `<repo>/.compass-cycles/<cycle_id>/state.json`            |
| context.md                    | `<repo>/.compass-cycles/<cycle_id>/context.md`            |
| discovery.md                  | `<repo>/.compass-cycles/<cycle_id>/discovery.md`          |
| decisions.md                  | `<repo>/.compass-cycles/<cycle_id>/decisions.md`          |
| blocker.md (when blocked)     | `<repo>/.compass-cycles/<cycle_id>/blocker.md`            |
| per-phase transcript          | `<repo>/.compass-cycles/<cycle_id>/transcript/<phase>.log` |
| branch                        | `main` (no branch creation)                               |

### Shared by both lanes

| File                          | Path                                                      |
|-------------------------------|-----------------------------------------------------------|
| backlog                       | `<repo>/docs/lanes/backlog.md`                            |
