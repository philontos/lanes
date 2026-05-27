import { skillsForPhase } from "./phases.js";

// `laneRel` is the active cycle's lane dir relative to the worktree root
// (e.g. ".lane/cycles/cycle-<ts>") — the orchestrator resolves it from the
// .lane/current-cycle pointer and injects it so artifact paths are cycle-scoped.
// `rubric` (review) and `reviewFeedback` (impl retry) drive the quality gate.
interface PromptCtx { config: any; request: string; agentsMd: string; laneRel?: string; rubric?: string; reviewFeedback?: string[] }

// Per-phase read/write targets, parameterised by the cycle's lane dir.
const phaseIO = (lane: string): Record<string, { reads: string; writes: string }> => ({
  spec: {
    reads: "the request below and the AGENTS.md constraints",
    writes: `${lane}/spec.md (goal, scope in/out, files to change, success criteria, risks)`,
  },
  plan: {
    reads: `${lane}/spec.md`,
    writes: `${lane}/plan.md (bite-sized, testable steps)`,
  },
  impl: {
    reads: `${lane}/plan.md and ${lane}/spec.md`,
    writes: "the actual code changes in the working directory; use Bash to run builds/tests",
  },
  review: {
    reads: `the git diff so far, plus ${lane}/spec.md and ${lane}/plan.md`,
    writes: `${lane}/review.md (the prose audit) AND ${lane}/verdict.json — exactly {"verdict":"pass"|"reject","reasons":[...]}. Judge only: do NOT edit code yourself; a "reject" re-runs the impl phase to fix the listed reasons`,
  },
});

// Pure: builds the English instruction handed to the per-phase Agent SDK session.
export function buildPhasePrompt(phase: string, ctx: PromptCtx): string {
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
    phase === "review" && ctx.rubric
      ? `=== ENGINEERING RUBRIC (audit the diff against EVERY item; "reject" if any is violated, citing it) ===\n${ctx.rubric}`
      : "",
    phase === "impl" && ctx.reviewFeedback?.length
      ? `=== A PREVIOUS REVIEW REJECTED THIS WORK — make targeted fixes addressing every point, keep build & tests green, stay in scope ===\n- ${ctx.reviewFeedback.join("\n- ")}`
      : "",
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
    "Constraints: AskUserQuestion is auto-answered by the operator judge per judge-principles.md.",
    "All tools are available, including Bash. Keep changes scoped to the request.",
  ].filter(Boolean).join("\n");
}
