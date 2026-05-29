import { skillsForPhase } from "./phases.js";

// `laneRel` is the active cycle's lane dir relative to the worktree root
// (e.g. ".lane/cycles/cycle-<ts>") — the orchestrator resolves it from the
// .lane/current-cycle pointer and injects it so artifact paths are cycle-scoped.
// `rubric` (review) and `reviewFeedback` (impl retry) drive the quality gate;
// `designPrinciples` (spec/impl) is the UI aesthetic bar, applied only to UI work.
// `mode` is currently only read by the init prompt. When set to "overwrite", init
// re-derives all four state docs from code even if the project already has
// content from a prior init — the user opted in via the [Re-init…] confirm modal.
interface PromptCtx { config: any; request: string; agentsMd: string; laneRel?: string; rubric?: string; reviewFeedback?: string[]; designPrinciples?: string; mode?: string }

// Per-phase read/write targets, parameterised by the cycle's lane dir.
const phaseIO = (lane: string): Record<string, { reads: string; writes: string }> => ({
  spec: {
    reads: "the request below and the AGENTS.md constraints",
    writes: `${lane}/spec.md (goal, scope in/out, files to change, success criteria, risks) AND ${lane}/codebase-map.md (a concise orientation for later phases: key files & their roles, directory structure, conventions/style, build & test commands, where new code goes — a MAP, not a code dump)`,
  },
  plan: {
    reads: `${lane}/codebase-map.md and ${lane}/spec.md`,
    writes: `${lane}/plan.md (bite-sized, testable steps)`,
  },
  impl: {
    reads: `${lane}/codebase-map.md, ${lane}/plan.md and ${lane}/spec.md`,
    writes: "the actual code changes in the working directory; use Bash to run builds/tests",
  },
  review: {
    reads: `the git diff so far, plus ${lane}/codebase-map.md, ${lane}/spec.md and ${lane}/plan.md`,
    writes: `${lane}/review.md (the prose audit) AND ${lane}/verdict.json — exactly {"verdict":"pass"|"reject","reasons":[...]}. Judge only: do NOT edit code yourself; a "reject" re-runs the impl phase to fix the listed reasons`,
  },
});

// Pure: builds the English instruction handed to the per-phase Agent SDK session.
// Dispatches by phase name — init / reshape / reflect lanes edit .lanes/* docs
// (not code) and have fundamentally different prompts from forge's phases.
export function buildPhasePrompt(phase: string, ctx: PromptCtx): string {
  if (phase === "init") return buildInitPrompt(ctx);
  if (phase === "reshape") return buildReshapePrompt(ctx);
  if (phase === "reflect") return buildReflectPrompt(ctx);
  return buildForgePhasePrompt(phase, ctx);
}

// ── Forge prompt (spec / plan / impl / review) ─────────────────────────────
function buildForgePhasePrompt(phase: string, ctx: PromptCtx): string {
  const lane = ctx.laneRel ?? ".lane";
  const skillNames = skillsForPhase(ctx.config, phase);
  const io = phaseIO(lane)[phase] ?? { reads: `the prior ${lane}/ artifacts`, writes: `the next ${lane}/ artifact` };
  return [
    `You are running the "${phase}" phase of the forge lane. No human is present.`,
    `Original request: ${ctx.request || "(none)"}`,
    skillNames.length
      ? `Use these skills for this phase: ${skillNames.join(", ")}.`
      : `No skill is mapped for this phase — do an independent review pass against the rubric below.`,
    `Read: ${io.reads}.`,
    `Produce: ${io.writes}.`,
    `Your working directory is the worktree root; every path here (including ${lane}/) is relative to it — do not invent absolute paths like /root/project or /Users/....`,
    phase !== "spec"
      ? `Begin from ${lane}/codebase-map.md for structure & conventions, and open only the specific files you still need — do not re-scan the whole tree.`
      : "",
    phase === "review" && ctx.rubric
      ? `=== ENGINEERING RUBRIC (audit the diff against EVERY item; "reject" if any is violated, citing it) ===\n${ctx.rubric}`
      : "",
    phase === "impl" && ctx.reviewFeedback?.length
      ? `=== A PREVIOUS REVIEW REJECTED THIS WORK — make targeted fixes addressing every point, keep build & tests green, stay in scope ===\n- ${ctx.reviewFeedback.join("\n- ")}`
      : "",
    phase === "impl" && ctx.designPrinciples
      ? `=== IF THIS INVOLVES ANY UI/FRONTEND ===\nUse the frontend-design skill for craft, and follow this design bar — aim for elegant / simple / tasteful, avoiding BOTH generic AI-slop AND maximalist overkill:\n${ctx.designPrinciples}`
      : "",
    phase === "spec" && ctx.designPrinciples
      ? `=== IF THIS INVOLVES ANY UI/FRONTEND ===\nDecide and record the aesthetic direction in the spec, following this design bar:\n${ctx.designPrinciples}`
      : "",
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
    "Constraints: AskUserQuestion is auto-answered by the operator judge per judge-principles.md.",
    "All tools are available, including Bash. Keep changes scoped to the request.",
  ].filter(Boolean).join("\n");
}

// ── Init prompt (bootstrap from code) ──────────────────────────────────────
// Init lane MODELS the project from its codebase reality. It's the
// "bootstrap" operation: scan what's there, name it, write it down in the
// 5-layer shape. Does NOT plan forward work — that's reshape/forge.
// User intent (state.request) is OPTIONAL light constraint, not the main
// signal. Codebase is the primary truth.
export function buildInitPrompt(ctx: PromptCtx): string {
  const skillNames = skillsForPhase(ctx.config, "init");
  const isOverwrite = ctx.mode === "overwrite";
  return [
    `You are running the "init" lane${isOverwrite ? " in RE-INIT (overwrite) mode" : ""}. No human is present.`,
    ``,
    `## Your job — bootstrap from code`,
    `Read the existing codebase and produce a faithful five-layer model of WHAT THIS PROJECT IS, written into .lanes/*. You are NOT planning future work; you are mapping current reality. Ground every claim in actual code, not speculation.`,
    ``,
    isOverwrite
      ? `**Re-init mode active.** This project ALREADY has \`.lanes/{summary,spec,features,plan}\` from a prior init or reshape. The user explicitly chose to overwrite — they were not happy with the prior content (commonly: wrong language, wrong framing, wrong stack guess). Re-derive everything FROM THE CODE, using the user's note as a fresh constraint. Do not try to merge or preserve the prior content's framing.\n\n**Backlog protection:** \`.lanes/backlog.json\` is the user's in-flight work record — DO NOT overwrite it. Leave it byte-for-byte unchanged. Re-init only touches the four upper-layer files.\n\n**Stable-ID preservation:** for any feature in the EXISTING \`features.json\` whose concept still applies to the current code (same capability, even if you'd phrase it differently), KEEP its \`id\` — backlog items may reference it. Update title/why/design_notes freely. Only allocate new feature IDs (from \`next_id_seq\`) for capabilities that didn't have an entry before.`
      : ``,
    ``,
    `Mental model:`,
    `- L0 Summary, L1 Spec, L2 Features, L3 Plan = **current-state model** (anatomy of what's already there).`,
    `- L4 Backlog = forward-looking. Leave it alone or near-empty — DO NOT log already-implemented capabilities as backlog items. Capabilities that exist belong in features.json with \`lifecycle: "active"\`.`,
    ``,
    `## Inputs (priority order)`,
    `1. **The codebase (PRIMARY)** — read it via Glob/Grep/Read. Look at file structure, package.json / pyproject.toml / go.mod / Cargo.toml etc for stack, the README for intent, the actual source for capability boundaries.`,
    isOverwrite
      ? `2. **Existing .lanes/features.json (for ID continuity ONLY)** — quickly note the existing feature IDs and their concepts so you can preserve IDs for capabilities that still exist. Do NOT let the existing titles / why / design_notes / spec / plan content frame your thinking — that's exactly what the user wants replaced.`
      : `2. **Existing .lanes/* (if any)** — may not exist at all (fresh project, you'll create the dir). If it does exist, it could be placeholders or a prior init's output. Skim once; you're overwriting either way.`,
    `3. **Optional user note (state.request)** — may contain constraints or focus hints ("scope OUT mobile, we never plan to do it", "only model src/, ignore docs/", "write everything in 中文"). Treat as soft constraints, not the main signal. May be empty.`,
    ``,
    `User's note for this run:`,
    ctx.request ? `> ${ctx.request}` : `> (no note provided — pure auto-scan from code)`,
    ``,
    skillNames.length
      ? `## Skills available\n${skillNames.join(", ")}.`
      : `## Skills available\n(none configured — do your best without)`,
    ``,
    `## Then write (overwrite all four with Write tool)`,
    ``,
    `- **.lanes/summary.md** — one paragraph (≤ 200 chars body), purely factual: what this repo IS and the problem it solves. No status, no metadata.`,
    ``,
    `- **.lanes/spec.md** — markdown with these six fixed H2 sections (ALL required, in order):`,
    `  - \`## Goal\` — prose, 1-3 paragraphs: what the project does now and who it's for. Derive from README + code.`,
    `  - \`## Scope IN\` — bullet list of currently shipped capabilities (what the code actually does today).`,
    `  - \`## Scope OUT\` — bullet list with "— reason" for things explicitly NOT in. Cite reasons from code (deprecated paths, removed features, explicit absence).`,
    `  - \`## Success Criteria\` — bullet list of observable signals the project is doing its job. (For libraries: API behaves per docs. For CLI: commands work. Etc.)`,
    `  - \`## Open Questions\` — real ambiguities you found while reading the code. Be specific.`,
    `  - \`## Constraints\` — hard requirements found in the repo (stack choices that can't be easily changed, version pins, license constraints, deployment requirements).`,
    ``,
    `- **.lanes/features.json** — schema:`,
    `  \`\`\`jsonc`,
    `  {`,
    `    "next_id_seq": <int, one greater than the highest feature-NNNN you create>,`,
    `    "features": [`,
    `      {`,
    `        "id": "feature-0001",            // sequential from feature-0001`,
    `        "title": "<short capability name, ~3-6 words>",`,
    `        "why": "<1-2 sentences: why this capability exists, derived from code/README>",`,
    `        "design_notes": "<can be empty; or a short note on how it's implemented in code>",`,
    `        "lifecycle": "active",            // all bootstrap features are active`,
    `        "superseded_by": null,`,
    `        "created_at": "<ISO 8601, current time>"`,
    `      }`,
    `    ]`,
    `  }`,
    `  \`\`\``,
    `  Aim for **5-10 features** that together describe the project's anatomy. Each = a named capability block actually present in the code (e.g. "Request routing", "Auth middleware", "JSON config loader"). Features map the project; they are not a TODO list.`,
    ``,
    `- **.lanes/plan.md** — short global technical foundation:`,
    `  - Stack (languages, frameworks, key libraries, all found in the repo)`,
    `  - Architecture: one paragraph describing how the pieces fit (data flow, layering, isolation boundaries). A small ASCII diagram is welcome if it clarifies.`,
    `  - Cross-feature key decisions present in the code, each with a one-line rationale (e.g. "Single-binary Go: deployability over micro-service flexibility").`,
    ``,
    `## Out of scope for init`,
    `- DO NOT create .lanes/backlog.json items for capabilities the code already has. Leave it as the post-scaffold empty state ({"next_id_seq": 1, "items": []}) unless the user's note explicitly asks for upcoming work.`,
    `- DO NOT modify business code anywhere outside .lanes/.`,
    ``,
    `## After writing — and write a reflection`,
    `Also write \`${ctx.laneRel ?? ".lane"}/reflection.md\` summarising what you produced and why. Schema:`,
    ``,
    `\`\`\`markdown`,
    `# Reflection — init cycle`,
    ``,
    `## What this cycle produced`,
    `(one short paragraph)`,
    ``,
    `## Key decisions`,
    `- (3-6 bullets: what you chose to model vs ignore, why)`,
    ``,
    `## Discovered / surfaced`,
    `- (anything noteworthy in the code that the user might want to revisit)`,
    `\`\`\``,
    ``,
    `Then commit:`,
    `\`\`\``,
    `git add .lanes/ ${ctx.laneRel ?? ".lane"}/reflection.md`,
    isOverwrite
      ? `git commit -m "re-init: re-derive .lanes/* from code (overwrite)"`
      : `git commit -m "init: bootstrap .lanes/ from code"`,
    `\`\`\``,
    `Cycle is already on lanes/<cycle-id>; commit is safe. User merges to apply.`,
    ``,
    `## Constraints`,
    `- AskUserQuestion is auto-answered by the operator judge per judge-principles.md — but try to avoid asking; the code IS the source of truth.`,
    `- spec.md MUST have all six H2 sections in order, even if some are "(none found)".`,
    ``,
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
  ].filter(Boolean).join("\n");
}

// ── Reshape prompt (intent-driven edits to existing .lanes/) ───────────────
// Reshape lane modifies the EXISTING .lanes/* per the user's request. The
// .lanes/* docs are already a working model; reshape makes targeted edits
// without rewriting unrelated content. Stable-ID discipline is strict —
// backlog items may reference feature IDs that must not break.
export function buildReshapePrompt(ctx: PromptCtx): string {
  const skillNames = skillsForPhase(ctx.config, "reshape");
  return [
    `You are running the "reshape" lane. No human is present.`,
    ``,
    `## Your job — targeted edits per intent`,
    `The project already has a working five-layer model at .lanes/*. The user has a specific change in mind. Make MINIMAL, SURGICAL edits that satisfy the user's request and preserve everything you weren't asked to touch.`,
    ``,
    `This is NOT a full rewrite. If the user asks "add feature X", touch features.json and possibly plan.md + spec.md — leave summary alone unless the project's identity actually changed.`,
    ``,
    `## The user's request (this is the PRIMARY signal)`,
    ctx.request ? `> ${ctx.request}` : `> (none provided — this is invalid input; do nothing and emit an error commit message)`,
    ``,
    skillNames.length
      ? `## Skills available\n${skillNames.join(", ")}.`
      : `## Skills available\n(none configured — do your best without)`,
    ``,
    `## Read first`,
    `1. **.lanes/summary.md, .lanes/spec.md, .lanes/plan.md, .lanes/features.json, .lanes/backlog.json** — the current model. This is the canvas you're editing.`,
    `2. **Codebase (secondary context)** — only if the request references specific code/files/features. Use Glob/Grep/Read sparingly.`,
    ``,
    `## Editing rules (read carefully — getting these wrong silently breaks the system)`,
    ``,
    `**Stable IDs:**`,
    `- Existing \`feature-NNNN\` and \`item-NNNN\` IDs are FOREVER. Renaming a title is fine; recycling an ID is forbidden.`,
    `- New features/items get the next sequential ID from \`next_id_seq\` in the respective file. Increment \`next_id_seq\` after each allocation.`,
    ``,
    `**Soft delete only:**`,
    `- To "remove" a feature: set \`lifecycle: "dropped"\` (and optionally \`superseded_by: "feature-NNNN"\` if there's a replacement). DO NOT splice the entry from the array.`,
    `- To "remove" a backlog item: set \`status: "dropped"\` (and optionally \`superseded_by\`). DO NOT splice.`,
    ``,
    `**Minimal blast radius:**`,
    `- Touch ONLY what the user asked for. Don't reorganize spec.md sections, rename unrelated features, or rewrite plan.md unless the request demands it.`,
    `- Prefer the **Edit tool** (small targeted edits) over **Write** (full rewrite) for markdown files. JSON files generally need Write because of structural ordering.`,
    ``,
    `**File-by-file constraints:**`,
    `- **spec.md** — keep all six H2 sections in canonical order: Goal, Scope IN, Scope OUT, Success Criteria, Open Questions, Constraints. Edit only the affected section(s).`,
    `- **features.json** — APPEND new (sequential IDs); soft-drop unwanted; modify only the touched features' \`title\`/\`why\`/\`design_notes\`/\`lifecycle\`/\`superseded_by\`. Leave others byte-for-byte unchanged.`,
    `- **backlog.json** — append-only safe edits:`,
    `  - APPEND new items (sequential IDs from \`next_id_seq\`; status="todo", cycles=[], completed_at=null, superseded_by=null).`,
    `  - SOFT-DROP existing items (status="dropped" and/or superseded_by).`,
    `  - DO NOT mutate an existing item's \`status\` to anything other than \`"dropped"\`, NOR change its \`title\`/\`acceptance\`/\`feature_id\`/\`cycles[]\`/\`completed_at\`. Those are the running record owned by the forge lane.`,
    `- **summary.md / plan.md** — edit only if the request requires it.`,
    ``,
    `## After writing — and write a reflection`,
    `Also write \`${ctx.laneRel ?? ".lane"}/reflection.md\` summarising the change. Schema:`,
    ``,
    `\`\`\`markdown`,
    `# Reflection — reshape cycle`,
    ``,
    `## What changed`,
    `(per-file, brief)`,
    ``,
    `## Why`,
    `(short rationale tying back to the user's request)`,
    ``,
    `## Stable-ID preservation`,
    `(list IDs touched, confirm none recycled)`,
    `\`\`\``,
    ``,
    `Then commit:`,
    `\`\`\``,
    `git add .lanes/ ${ctx.laneRel ?? ".lane"}/reflection.md`,
    `git commit -m "reshape: <one-line summary of the change>"`,
    `\`\`\``,
    `Cycle is on lanes/<cycle-id>. User merges to apply.`,
    ``,
    `## Constraints`,
    `- DO NOT modify business code outside .lanes/.`,
    `- AskUserQuestion is auto-answered by the operator judge per judge-principles.md.`,
    ``,
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
  ].filter(Boolean).join("\n");
}

// ── Reflect prompt (forge's strong-consistency closer) ─────────────────────
// Forge's reflect phase runs after a passed review. It is the closed-loop step
// that keeps the project's 5-layer state aligned with the code that just got
// written. Reads: cycle's own artifacts + the git diff this branch produced +
// current .lanes/* (project state). Writes: targeted updates to .lanes/* (any
// of them, except the running record fields owned by the per-cycle integration
// step — see below) plus a reflection.md the user can read.
export function buildReflectPrompt(ctx: PromptCtx): string {
  const lane = ctx.laneRel ?? ".lane";
  return [
    `You are running the "reflect" phase of the forge lane. No human is present.`,
    ``,
    `## Why this phase exists`,
    `The cycle just changed code. The project's 5-layer state at .lanes/* is now potentially out of sync with the code — implementation might have differed from the original spec, discovered new dependencies, made architectural decisions worth recording, or surfaced learnings. Your job is to make the state catch up, on this same cycle branch, so when the user merges everything stays consistent atomically.`,
    ``,
    `This is the closed-loop step. Skip it and drift creeps in.`,
    ``,
    `## Read first (in this order)`,
    `1. \`${lane}/spec.md\`, \`${lane}/plan.md\`, \`${lane}/review.md\`, \`${lane}/verdict.json\` — the cycle's own per-cycle artifacts (what was *intended* and how *review* judged it).`,
    `2. The actual diff this branch produced — Bash: \`git diff $(git merge-base HEAD main) HEAD\`. This is the GROUND TRUTH of what changed.`,
    `3. Current \`.lanes/summary.md\`, \`.lanes/spec.md\`, \`.lanes/features.json\`, \`.lanes/plan.md\`, \`.lanes/backlog.json\` — project-level state on this branch.`,
    `4. Original request: ${ctx.request || "(none)"}`,
    ``,
    `## What to write (use Edit / Write tools)`,
    ``,
    `Examine the diff against the project state. For EACH layer, ask: "did this cycle change anything that means this file is now out of date?" If yes, update. If no, leave it alone.`,
    ``,
    `**.lanes/backlog.json** — APPEND new items the cycle discovered are needed (e.g. prerequisite features, follow-up cleanup, refactors surfaced). New items: status="todo", cycles=[], completed_at=null, sequential IDs from next_id_seq. **DO NOT mutate the item this cycle just completed** — its status/cycles[]/completed_at are owned by the orchestrator's integration step that runs after you.`,
    ``,
    `**.lanes/features.json** — APPEND any new features discovered (lifecycle="active"). UPDATE the affected feature's \`design_notes\` with a short bullet of implementation learning ("In cycle-XXX we found that ..."). Preserve all stable IDs.`,
    ``,
    `**.lanes/spec.md** — TARGETED edits if scope/success criteria/open questions need updating based on what the cycle implemented. Preserve all six H2 sections in order. If nothing changed at this layer, leave it.`,
    ``,
    `**.lanes/plan.md** — APPEND a key decision if the cycle made an architectural / dependency choice (e.g. "Cycle-XXX added Redis for session cache — chosen over in-memory because..."). If no such decision, leave alone.`,
    ``,
    `**.lanes/summary.md** — only touch if the project's identity actually changed (rare).`,
    ``,
    `## Write the reflection`,
    ``,
    `Then write \`${lane}/reflection.md\` — a short structured doc that the user reads to understand what this cycle changed at the project level. Schema:`,
    ``,
    `\`\`\`markdown`,
    `# Reflection — forge cycle <cycle-id>`,
    ``,
    `## What this cycle did`,
    `(one paragraph; reference both code and state changes)`,
    ``,
    `## Changes made to .lanes/*`,
    `- .lanes/backlog.json: appended item-NNNN "<title>" (discovered prerequisite)`,
    `- .lanes/features.json: appended to feature-NNNN.design_notes`,
    `- .lanes/spec.md: revised Scope IN bullet "X" to "Y"`,
    `- (one line per touched file; "no changes" if nothing)`,
    ``,
    `## Decisions worth highlighting`,
    `- (architectural / dependency / approach decisions made during this cycle)`,
    ``,
    `## Discovered work`,
    `- (new items / features surfaced; cite the new IDs)`,
    ``,
    `## Drift observations`,
    `- (anything in tension between code and state that this cycle did NOT fix; flag for the user)`,
    `\`\`\``,
    ``,
    `## Then commit`,
    `\`\`\``,
    `git add .lanes/ ${lane}/reflection.md`,
    `git commit -m "reflect: state delta from cycle (item: <item-id>)"`,
    `\`\`\``,
    ``,
    `If absolutely nothing in .lanes/* needs to change, still write reflection.md saying "no upstream changes needed" and commit just that file — the user wants to see that you considered it.`,
    ``,
    `## Constraints`,
    `- Stable IDs always preserved (feature-NNNN / item-NNNN never recycled).`,
    `- Soft delete only (lifecycle="dropped" / status="dropped").`,
    `- Do NOT touch business code in this phase — that's already done.`,
    `- Do NOT mutate the running-record fields of the item this cycle completed (the orchestrator's integration step writes those after you exit).`,
    ``,
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
  ].filter(Boolean).join("\n");
}
