# Lanes Platform v1 — Project State Paradigm & Read-Only Web

> Status: design accepted, ready for implementation planning.
> Scope: v1 only. Roadmap items live in **Scope OUT**.

## Goal

Today `lanes` runs one cycle at a time and forgets — every run starts fresh from a free-text request, and the only persistent artifact is whatever code landed in the worktree. The user juggles many projects in many repos; their spec / plan / progress live in their head, in stale READMEs, or not at all. Switching back to a project a week later means reconstructing context from `git log` and memory.

This v1 turns `lanes` from a per-cycle engine into a **long-lived project engine** by introducing a small, fixed-shape **project state model** that lives next to the code, evolves through the same git branches `lanes` already uses, and is **always current by construction**. On top of that model, a minimal **read-only web** lets the user scan multiple projects' real states at a glance and drill down without losing context.

The load-bearing claim of the platform is: **"what you see is the truth right now"** — guaranteed by two pillars:

1. **Strong consistency** — docs live in the repo, evolve through the same branches that ship code; merging into `main` *is* updating the canonical project state. No separate store, no sync job, no drift.
2. **Stable paradigm** — every project's state has the same shape, the same files, the same fields, the same IDs. Cross-project scanning is possible because cross-project structure is identical.

Either pillar alone is insufficient: fresh-but-shapeless data is unscannable; stable-but-stale schema is misleading.

## Background & Problem

`lanes` (see repo root) is a thin orchestrator over Claude Agent SDK that drives a fixed phase chain (`spec → plan → impl → review`) per cycle. Each cycle:

- Reads a free-text request from `state.json`
- Produces `.lane/cycles/<id>/{spec.md,plan.md,review.md}` (per-cycle artifacts, never reused across cycles)
- Modifies the worktree's actual code

The unit of execution is one cycle. There is no project concept — no long-lived spec, no backlog, no progress state. Once a cycle ends, its artifacts are essentially execution traces, not "what the project is."

The user's pain points:

- **Context cost on resume** — coming back to a project, there is no single document that says "this is what the project is, where it stands now, what's next."
- **Scattered tools** — spec is in a Notion page, plan is in a README, backlog is in Linear, progress is in commits. Nothing is in sync.
- **Per-project bespoke organization** — even when the user does document things, every project does it differently, so scanning multiple projects requires re-learning each one's layout.
- **Difficulty operating at "feature granularity"** — modern AI-assisted dev lets one person carry many feature-sized concerns concurrently, but only if the system surfaces those concerns at the right altitude.

The fix is not "another dashboard." Dashboards go stale. The fix is a **fixed-shape, repo-native project model** that the existing `lanes` cycle is extended to maintain as a first-class effect of running.

## The Paradigm

A `lanes`-managed project has exactly **five layers**, each present in every project (placeholder if empty), each with its own file:

```
.lanes/
├── summary.md       L0  Cover — one paragraph: what is this / what problem does it solve
├── spec.md          L1  WHAT & WHY — product intent, in product language
├── features.json    L2  WHAT-PIECES — flat list of named capability blocks
├── plan.md          L3  HOW — global technical foundation
└── backlog.json     L4  NEXT-STEPS — executable items, each ≈ one lanes cycle
```

### Layer purposes (single judging question each)

| Layer | Judging question | Language |
|-------|------------------|----------|
| L0 Summary | Can a stranger understand what this is in 10 seconds? | Plain prose, ≤ 200 chars |
| L1 Spec | What outcome are we delivering, why, and where does scope end? | Product language (no tech names) |
| L2 Features | If we listed the 5–10 capabilities this project is composed of, what are they? | Capability names + rationale |
| L3 Plan | What does a new engineer need to know about stack / architecture / cross-feature decisions? | Engineering language (no user stories) |
| L4 Backlog | Is this one thing a single `lanes` cycle can finish? | Concrete actionable items |

**Disambiguation rule** between L1 and L3: the same idea in L1 is phrased *"users can X"*; in L3 it's *"implemented with Y on Z architecture."* If a sentence could plausibly live in either, it isn't written clearly enough — split.

**Disambiguation rule** between L2 and L4: a Feature is a **stable capability** that persists across the project's lifetime; an Item is a **consumed action** that flows through it.

### Why this ordering (Spec → Features → Plan → Backlog)

Tech plans are written against features, not in a vacuum. Putting Plan before Features (an earlier draft of this design) leaves L3 either rootless ("global tech middle-platform" with no grounding) or implicitly assuming features that haven't been declared yet. The corrected order — features first, then plan — gives L3 a concrete "for what" to design against.

### Invariants (load-bearing; everything else depends on these)

1. **Stable IDs, never reused.** Once `feature-0007` or `item-0042` is assigned, that ID refers to that thing forever. Renaming the title is fine; recycling the ID is not. References across layers (item → feature_id, item → cycle_id) use IDs.
2. **Soft deletion only.** `dropped` is a status; `superseded_by: feature-0012` records replacement. Hard `splice()` from arrays is forbidden — items / features stay in the file in a tombstoned form. Aggregation logic ignores dropped entries.
3. **Single source of truth for status: L4 items.** `feature.status` and project-level rollups are *derived* on read, not stored. Storing them invites contradictions.
4. **Each layer in its own file.** Layers are decoupled — editing `spec.md` does not force a rewrite of any other file. This is what makes "edit one layer, leave others stale until you choose to update them" viable.
5. **Every layer is mandatory.** Empty placeholders (`(TBD)`) are allowed; layer skipping is not. Cross-project scanning requires every project to have every layer present.
6. **Git is the audit log.** `git log -p .lanes/spec.md` is the complete evolution history of L1. No bespoke event log, no version number, no `last_modified_by` field. Git already does all of this.

### Mutability profile per layer

| Layer | Frequency | Driven by |
|-------|-----------|-----------|
| L0 Summary | Slow | Manual or doc-evolve cycle |
| L1 Spec | Slow | Manual or doc-evolve cycle |
| L2 Features (structure) | Slow | Manual (add/rename/split/merge) |
| L2 Features (`design_notes`) | Medium | Cycle-side updates allowed |
| L3 Plan | Slow | Manual or doc-evolve cycle |
| L4 Backlog (item status, cycles[]) | High | Cycle-side updates (automatic) |
| L4 Backlog (item structure: add/rename/move) | Medium | Manual only |

## File Layout & Schemas

### `summary.md`

```markdown
# <project-name>

<One paragraph, ≤ 200 chars. What is this. What problem it solves.>
```

No headings, no metadata, no status. Pure cover copy.

### `spec.md`

Six fixed H2 sections. **All six must be present** in every project (use `(none yet)` if empty).

```markdown
## Goal
<Prose, 1–3 paragraphs. The product intent — who, what experience, why now.
Must be readable prose, not bullets. This is the 30-second briefing.>

## Scope IN
- <closed list of committed deliverables>

## Scope OUT
- <thing explicitly NOT in this version> — <reason / deferred to where>

## Success Criteria
- <observable, testable signal that the goal is met>

## Open Questions
<Prose or questions. Unresolved decisions blocking downstream work.>

## Constraints
<Hard requirements: stack lock-ins, compliance, deadlines, irreversible prior decisions.>
```

**Rule:** `## Goal` must be prose; the rest may be prose or bullets at the author's choice.

Schema validation = `grep '^## ' .lanes/spec.md` returns exactly six known headings in order.

### `features.json`

```jsonc
{
  "next_id_seq": 8,                  // monotonic, never decreases
  "features": [
    {
      "id": "feature-0001",          // stable, never reused
      "title": "Forge lane orchestration",
      "why": "<1–2 sentences: why this capability exists>",
      "design_notes": "<freeform; per-feature implementation guidance; cycle may append>",
      "lifecycle": "active",         // "active" | "dropped" — the only stored state
      "superseded_by": null,         // or "feature-0012"
      "created_at": "2026-05-28T12:00:00Z"
    }
  ]
}
```

- `lifecycle` is `active` by default; `"dropped"` is the only manual override. **The field is intentionally named `lifecycle`, not `status`, to avoid being confused with the derived `display_status`.**
- The displayed feature status (todo / in-progress / done) is **derived** from its items at read time (see *Derived status* below), never stored
- `next_id_seq` ensures IDs are never reused across edits

### `backlog.json`

```jsonc
{
  "next_id_seq": 43,
  "items": [
    {
      "id": "item-0001",
      "title": "Implement spec phase calling brainstorming skill",
      "feature_id": "feature-0001",
      "acceptance": [
        "<observable acceptance criterion 1>",
        "<observable acceptance criterion 2>"
      ],
      "status": "todo",              // todo | in-progress | done | blocked | dropped
      "cycles": [                    // append-only history of cycles run against this item
        { "cycle_id": "cycle-20260528-120000", "verdict": "pass", "at": "2026-05-28T12:30:00Z" }
      ],
      "notes": "",
      "superseded_by": null,
      "created_at": "2026-05-28T11:00:00Z",
      "completed_at": null
    }
  ]
}
```

Status transitions:

| From → To | Trigger |
|-----------|---------|
| todo → in-progress | orchestrator on cycle start |
| in-progress → done | orchestrator on cycle review pass |
| in-progress → blocked | orchestrator on cycle failure / max-turns / verdict-reject-exhausted |
| any → dropped | manual edit |
| any → todo | manual edit (e.g., to re-run after revising acceptance) |

### Derived status (read-time)

```
feature.display_status = (feature.lifecycle == "dropped") ? "dropped"
                       : (all items done)                 ? "done"
                       : (any item in-progress)           ? "in-progress"
                       : (any item blocked)               ? "blocked"
                       :                                    "todo"

project.display_status = aggregation of feature.display_status (same rules)
```

These are computed on every read; never stored.

## End-to-End: Life of an Item

### Phase A · Bootstrap (v1: option A only)

`lanes init` in an existing git repo scaffolds `.lanes/` with placeholder content:

- `summary.md` = `# <repo-name>\n\n(TBD — describe the project)`
- `spec.md` = six H2 sections, each containing `(none yet)`
- `features.json` = `{ "next_id_seq": 1, "features": [] }`
- `plan.md` = `# Tech Plan\n\n(TBD)`
- `backlog.json` = `{ "next_id_seq": 1, "items": [] }`

The user fills these by hand, or by running normal `lanes "<idea>"` cycles whose target is to populate `.lanes/*` files (rather than impl code).

**Out of scope for v1:** `lanes new "<idea>"` greenfield ideation lane. Roadmap.

### Phase B · Running an Item

The platform (or CLI) selects an item and synthesizes a structured request from:

```
item.title
item.acceptance[]
features[item.feature_id].design_notes
spec.md (Goal + relevant Scope IN bullets)
plan.md (relevant key decisions)
```

`lanes` runs as today: bootstrap creates `.lane/cycles/<cycle-id>/`, the orchestrator drives `spec → plan → impl → review` on a `lanes/<cycle-id>` branch.

**During the cycle**, the orchestrator writes to `.lanes/*` on the cycle's branch:

- On cycle start: `item.status = in-progress`, commit `.lanes/backlog.json`
- On review pass: `item.status = done`, `completed_at = now`, append cycle record; commit `.lanes/backlog.json`
- On review block / cycle failure: `item.status = blocked` with reason; commit
- Optionally: append to `features[item.feature_id].design_notes` if the cycle produced implementation learnings worth preserving; commit `.lanes/features.json`
- Optionally: write `.lane/cycles/<cycle-id>/integration-notes.md` proposing edits to spec / plan / summary (these are *proposals*, never auto-applied — see write-permissions table below)

All of these are commits on the cycle's `lanes/<cycle-id>` branch. None touch `main`.

### Phase C · Merging the Proposal

The branch represents a complete proposal: "after this item is done, the project state is X." The user reviews the branch (locally, via PR, however) and merges to `main`. **Merging = explicit approval to update the canonical project state.**

Not merging is also a clean operation: the branch's `.lanes/*` mutations stay isolated; `main`'s docs remain unchanged.

Multiple cycle branches in flight = multiple parallel proposals. Standard git merge resolves them; stable IDs make doc-level conflicts rare and resolvable.

### Phase D · Mid-Flight Edits

Manual editing of any `.lanes/*` file is fully supported and expected — it is just a normal git change. Stable IDs guarantee that renames, reorderings, and edits never break cross-layer references. Splitting a feature (one becomes two) or moving an item between features is done by hand-editing the JSON in v1; first-class commands for these operations are roadmap.

### Cycle Write Permissions (canonical table)

What a `lanes` cycle is allowed to modify on its branch:

| File | Cycle auto-writes? | Notes |
|------|--------------------|-------|
| `backlog.json` — item.status, cycles[], completed_at | ✅ required | Core cycle post-action |
| `features.json` — `design_notes` field on the affected feature | ✅ allowed | Implementation learnings belong here |
| `features.json` — id / title / structure / feature add/remove | ❌ forbidden | High-level intent, manual only |
| `spec.md` / `plan.md` / `summary.md` | ❌ forbidden, but cycle MAY write `integration-notes.md` proposing edits | Upper layers are slow-mutable by design |
| Worktree code | ✅ as today | impl phase produces code changes |

The user (or a separate, explicitly-invoked "doc-evolve" cycle) applies integration-notes proposals manually.

## Read-Only Web (v1)

A minimal local web app (single binary or `npm start`) serves a multi-project read-only dashboard:

- **Workspace index** at `~/.config/lanes/workspace.json` lists registered project repo paths
- The web reads each project's `.lanes/*` via `git show main:.lanes/<file>` (or libgit2 equivalent) on each request — **not** the working tree, so the user's current checkout in any repo does not change what the web shows. No DB, no cache layer.
- **Default view = the project's `main` branch state.** "What's actually shipped." Branch-state views (showing in-flight cycle proposals) are roadmap.

### Pages

1. **Workspace list** — one card per registered project: name, one-line summary (from `summary.md`), aggregated status (derived), count of items in each status bucket.
2. **Project detail** — five collapsible sections matching the five layers:
   - L0 Summary (rendered)
   - L1 Spec (rendered markdown with the six H2 sections)
   - L2 Features (list with `design_notes` expandable, status derived)
   - L3 Plan (rendered)
   - L4 Backlog (list, grouped by feature, showing status and most recent cycle)
3. **Item detail** (modal or sub-page) — full acceptance criteria, cycle history with links to each cycle's `.lane/cycles/<id>/run.log` if locally available.

### Non-features for v1

- No editing (write-back is roadmap)
- No triggering cycles from the UI (CLI only for v1)
- No discussion / chat (roadmap)
- No drift detection (does the actual repo match `backlog.json`?) — roadmap
- No multi-branch views (just `main`)
- No auth — local-only

## Scope OUT (v1)

These items are explicitly deferred. They are not "missing"; they are not in v1 deliberately.

- **`lanes new "<idea>"`** greenfield ideation lane — bootstrap is `lanes init` (option A) only. Reason: B path requires new lane semantics, new phase model, ~30–50% more engineering. Validate the paradigm first.
- **Stale flag** (when upstream layer changes, mark downstream as "may need realignment") — v1 relies on the human eyeballing branch diffs.
- **First-class `lanes feature split` / `lanes item move` commands** — v1 expects manual JSON edits.
- **Drift detection** between documented state and actual repo content — v1 trusts the cycle to keep them aligned via branch-based updates.
- **Writable web** (edit spec / add items / trigger cycles from browser) — v1 is strictly read-only.
- **Discussion / chat UI** for refining spec / plan / backlog through the platform — roadmap; v1 expects refinement via editor + CLI.
- **Multi-cycle scheduling, cross-cycle memory, retry policy** — same status as today's `lanes` roadmap.
- **`ship` phase** (real PR creation, branch promotion) — same status as today's `lanes` roadmap; the existing `lanes/<cycle-id>` branch convention is sufficient for v1 to work.

## Success Criteria

- Running `lanes init` in any existing git repo creates a complete `.lanes/` skeleton; the six H2 sections of `spec.md` are present (even if `(none yet)`).
- After a cycle finishes against item `X` on branch `lanes/<cycle-id>`, that branch's `.lanes/backlog.json` shows `X.status = "done"` with the cycle appended to `X.cycles[]`. `main`'s copy is unchanged until merge.
- Merging the branch to `main` makes those same changes visible at `main`.
- Stable-ID invariant holds: in any project, no two features / items ever share an ID, and IDs in `cycles[]` always resolve to a real cycle.
- Status invariant holds: there is no `feature.status` field for "in-progress / done" anywhere in storage; the displayed status is computed from items at read time.
- The web, given a `workspace.json` pointing at N project repos, renders the workspace list in under 2 seconds for N ≤ 20, and a project detail page in under 500ms.
- The web's display of any project's state is sourced from `git show main:.lanes/<file>` byte-for-byte (no working-tree leakage).
- A user can `lanes init` an empty repo, hand-write spec/features/one item, run a cycle against the item, see it land as `done` on the cycle branch's `.lanes/backlog.json` — round-trip in under 30 minutes including reading the UI.

## Open Questions

- **Concurrency on `.lanes/` writes.** If two cycles on two branches both touch `features.json` `design_notes` for the same feature, git merge handles it but may need conflict resolution. v1 accepts this as a normal merge case; v2 could serialize cycle starts per project or use a finer-grained file layout (one file per feature?) if conflicts become painful.
- **How the cycle decides whether to append to `design_notes`.** The current proposal is "optional, when the cycle judges there's a worth-recording learning." This is a judgment call delegated to the impl phase prompt. May need calibration after first runs.
- **Web's source for cycle history.** The web shows `cycles[]` with cycle IDs; clicking into a cycle requires the local `.lane/cycles/<id>/` dir to exist. If the user works on multiple machines, history may be incomplete. v1 accepts this; v2 could optionally sync `.lane/cycles/` to a shared store.
- **Bootstrap of `summary.md` from `spec.md`.** It's tempting to derive `summary.md` from `spec.md`'s Goal section. v1 keeps them separate (the cover may need its own framing); revisit if duplication becomes painful.

## Constraints

- State must live in the target repo's `.lanes/` directory. No central store, no SQLite, no SaaS dependency.
- Git is the only version-control / audit mechanism. No bespoke event log.
- The web is local-only, file-system-backed, read-only. No server-side state beyond config.
- The cycle's auto-edits to `.lanes/*` must respect the write-permissions table; agents must not silently edit `spec.md`, `plan.md`, `summary.md`, or structural fields of `features.json`.
- Existing `lanes` operating principles (Docker-as-boundary, judge-auto-answers, config-over-code, fail-loud) carry over unchanged.
- This v1 must not require modifications to the existing `forge` phase chain semantics — only additive: an integration step after `review`, and a small pre-cycle context-synthesis step before `spec`.

## Architecture Sketch (for the implementation plan)

```
sdk/src/
├── orchestrator.ts          (existing; extended to call project-state hooks)
├── project/                 (new)
│   ├── state.ts             read/write .lanes/* with schema validation
│   ├── ids.ts               stable-ID allocator (next_id_seq)
│   ├── derive.ts            compute feature.display_status / project.display_status
│   ├── integration.ts       post-review write-back: backlog.json item.status, design_notes, integration-notes.md
│   └── synthesize.ts        compose structured request from {item, feature, spec, plan} before cycle starts
└── cli/                     (new)
    ├── init.ts              `lanes init` — scaffold .lanes/
    └── run-item.ts          `lanes run item-XXXX` — pick an item, synthesize, start cycle

web/                         (new, separate package)
├── server.ts                tiny HTTP server reading filesystem
├── workspace.ts             ~/.config/lanes/workspace.json loader
└── ui/                      static SPA, server-rendered or vite
```

Existing files (`run.ts`, `phases.ts`, `prompts.ts`, `canUseTool.ts`, `judge.ts`, `plugins.ts`, `streamLog.ts`, `usage.ts`) require no semantic changes; only `orchestrator.runLane` gains hooks for pre-cycle synthesize and post-review integration.
