import { skillsForPhase } from "./phases.js";

// `laneRel` is the active cycle's lane dir relative to the worktree root
// (e.g. ".lane/cycles/cycle-<ts>") — the orchestrator resolves it from the
// .lane/current-cycle pointer and injects it so artifact paths are cycle-scoped.
// `rubric` (review) and `reviewFeedback` (impl retry) drive the quality gate;
// `designPrinciples` (spec/impl) is the UI aesthetic bar, applied only to UI work.
interface PromptCtx { config: any; request: string; agentsMd: string; laneRel?: string; rubric?: string; reviewFeedback?: string[]; designPrinciples?: string }

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
// Dispatches by phase name — the shape lane's prompt is fundamentally different
// (it edits .lanes/* docs, not code), so it has its own builder.
export function buildPhasePrompt(phase: string, ctx: PromptCtx): string {
  if (phase === "shape") return buildShapePrompt(ctx);
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

// ── Shape prompt ───────────────────────────────────────────────────────────
// Shape lane updates the project's five-layer state (.lanes/*) from a user
// intent + current state + the codebase. It does NOT touch business code —
// that's forge's job. Output: updated .lanes/{summary,spec,features,plan},
// committed on the cycle's lanes/<cycle-id> branch (the user merges to apply).
export function buildShapePrompt(ctx: PromptCtx): string {
  const skillNames = skillsForPhase(ctx.config, "shape");
  return [
    `You are running the "shape" lane. No human is present.`,
    ``,
    `## Your job`,
    `Update the project's five-layer state docs in .lanes/ so they accurately reflect (a) what the codebase currently IS and (b) what the user wants going forward.`,
    ``,
    `Mental model — what each layer captures:`,
    `- L0 Summary, L1 Spec, L2 Features, L3 Plan = **current-state model** of the project's anatomy (what it is, its intent, its capability blocks, its tech foundation). These include already-implemented things, not just future work.`,
    `- L4 Backlog = the **forward-looking work tracker** (the only forward-looking layer). New items go here; already-done capabilities stay implicit in features.json (not retroactively logged as items).`,
    ``,
    `Two common bootstrap scenarios:`,
    `1. **Existing repo, empty .lanes/** — your job is mostly mapping reality: read the code, name the capability blocks that already exist as features (lifecycle: "active"), describe the spec (Goal = what the project does now; Scope IN = current capabilities; Scope OUT = explicit non-goals), document the actual stack/arch in plan.md. Backlog may stay empty OR you may propose 1-3 starter items only for things the user's request explicitly asks for. **Do NOT create backlog items for capabilities the code already has** — that would mislead the work tracker.`,
    `2. **Existing project, evolving** — read current .lanes/ and the user's request; update spec/features/plan to reflect the new direction; APPEND backlog items for new work; soft-drop features/items the user wants gone.`,
    ``,
    `You may NOT modify business code outside .lanes/. The user reviews your output as a git diff on the cycle's branch and merges it themselves if it's good — so make this a complete, mergeable proposal.`,
    ``,
    `## The user's intent`,
    ctx.request || "(none — read .lanes/* and propose any obvious cleanups)",
    ``,
    skillNames.length
      ? `## Skills available\nUse these skills as needed: ${skillNames.join(", ")}.`
      : `## Skills available\n(none configured — do your best without)`,
    ``,
    `## Read first (in this order)`,
    `1. .lanes/summary.md, .lanes/spec.md, .lanes/plan.md, .lanes/features.json, .lanes/backlog.json — the current project state. May be placeholders ("(TBD)", "(none yet)") if just initialised.`,
    `2. The codebase via Glob/Grep/Read — get a real sense of structure, conventions, stack, what's actually there. Don't speculate. For an existing repo with empty .lanes/, this is the primary signal: derive spec/features/plan from what the code actually does.`,
    ``,
    `## Then write`,
    `Update these files with the Write tool (overwrite, full content each time):`,
    ``,
    `- **.lanes/summary.md** — one paragraph (≤ 200 chars body): what this project is and the problem it solves. No status field, no metadata, just the cover.`,
    ``,
    `- **.lanes/spec.md** — markdown with these six fixed H2 sections (ALL must be present, in this order):`,
    `  - \`## Goal\` — prose, 1-3 paragraphs (NOT bullets). Who, what experience, why now.`,
    `  - \`## Scope IN\` — bullet list, closed set of committed deliverables.`,
    `  - \`## Scope OUT\` — bullet list, each item with "— reason" for not being in. This is load-bearing — it stops scope creep.`,
    `  - \`## Success Criteria\` — bullet list, observable/testable signals that the goal is met.`,
    `  - \`## Open Questions\` — prose or questions, unresolved decisions blocking downstream.`,
    `  - \`## Constraints\` — hard requirements (stack, compliance, deadlines).`,
    ``,
    `- **.lanes/features.json** — schema:`,
    `  \`\`\`jsonc`,
    `  {`,
    `    "next_id_seq": <int, monotonically increasing>,`,
    `    "features": [`,
    `      {`,
    `        "id": "feature-NNNN",         // stable, NEVER reused; preserve existing IDs if a feature's identity is unchanged`,
    `        "title": "<short capability name>",`,
    `        "why": "<1-2 sentences: why this exists>",`,
    `        "design_notes": "<freeform; per-feature implementation guidance — can be empty>",`,
    `        "lifecycle": "active" | "dropped",`,
    `        "superseded_by": null | "feature-NNNN",`,
    `        "created_at": "<ISO 8601>"`,
    `      }`,
    `    ]`,
    `  }`,
    `  \`\`\``,
    `  Rules: 5-10 features is the sweet spot. Preserve IDs of unchanged features. New features get sequential IDs starting from next_id_seq, and increment it. To remove a feature: set lifecycle="dropped" (do NOT delete the entry — soft delete only). To rename or restructure: keep the existing entry, mark it lifecycle="dropped" with superseded_by pointing at the replacement, and add the replacement as a new feature.`,
    ``,
    `- **.lanes/plan.md** — short global technical foundation. Stack choices, overall architecture (1 paragraph + maybe a small diagram), cross-feature key decisions (each with a one-line rationale). NOT per-feature implementation details — those live in feature.design_notes.`,
    ``,
    `- **.lanes/backlog.json** — append-only safe edits ONLY (forge owns the high-frequency status changes). You MAY:`,
    `  - APPEND brand-new items (sequential IDs from next_id_seq; increment it).`,
    `  - Soft-drop an existing item by setting its \`status: "dropped"\` and/or \`superseded_by: "item-NNNN"\`.`,
    `  - You may NOT change an existing item's \`status\` to anything other than \`"dropped"\`, NOR change its \`title\`/\`acceptance\`/\`feature_id\`/\`cycles[]\`/\`completed_at\`. Those are the running record of work, owned by forge.`,
    `  - Schema (per item): { id, title, feature_id, acceptance:[], status: "todo"|"in-progress"|"done"|"blocked"|"dropped", cycles:[], notes, superseded_by, created_at, completed_at }`,
    `  - New items default to: status="todo", cycles=[], completed_at=null, superseded_by=null. Tie items to a feature_id from features.json — if you added new features, link new items to them.`,
    `  - 5-10 starter items for a fresh project is the sweet spot; for evolution, just add the items that the new request demands.`,
    ``,
    `## Stable-ID discipline (critical)`,
    `- Existing feature IDs MUST be preserved if the feature's identity is unchanged. The user may have backlog items pointing at these IDs; renaming the title is fine, recycling the ID is forbidden.`,
    `- New IDs come from features.json's next_id_seq, padded to 4 digits (e.g. feature-0007). Increment next_id_seq for each new feature.`,
    `- Same for items (backlog.json) — but you're not editing that file in this lane.`,
    ``,
    `## After writing`,
    `Run these commands via Bash:`,
    `\`\`\``,
    `git add .lanes/`,
    `git commit -m "shape: <one-line summary of what this proposal changes>"`,
    `\`\`\``,
    `The cycle already pre-branched onto lanes/<cycle-id>, so this commit is safe — it never touches main. The user merges if they accept.`,
    ``,
    `## Constraints`,
    `- Do NOT modify business code (anything outside .lanes/).`,
    `- .lanes/backlog.json is append-only safe: add new items, soft-drop existing — do not mutate existing items' running state (status other than "dropped", cycles, completed_at).`,
    `- AskUserQuestion is auto-answered by the operator judge per judge-principles.md — but try to avoid asking; you have the codebase + the user's request, that's usually enough.`,
    `- spec.md MUST have all six H2 sections, in order, even if some are "(none yet)".`,
    ``,
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
  ].filter(Boolean).join("\n");
}
