import { skillsForPhase } from "./phases.js";

interface PromptCtx { config: any; request: string; agentsMd: string }

const PHASE_IO: Record<string, { reads: string; writes: string }> = {
  spec: {
    reads: "the request below and the AGENTS.md constraints",
    writes: ".lane/spec.md (goal, scope in/out, files to change, success criteria, risks)",
  },
  plan: {
    reads: ".lane/spec.md",
    writes: ".lane/plan.md (bite-sized, testable steps)",
  },
  impl: {
    reads: ".lane/plan.md and .lane/spec.md",
    writes: "the actual code changes in the working directory; use Bash to run builds/tests",
  },
  review: {
    reads: "the git diff so far, plus .lane/spec.md and .lane/plan.md",
    writes: ".lane/review.md, and fix any correctness or scope issues you find",
  },
};

// Pure: builds the English instruction handed to the per-phase Agent SDK session.
export function buildPhasePrompt(phase: string, ctx: PromptCtx): string {
  const skillNames = skillsForPhase(ctx.config, phase);
  const io = PHASE_IO[phase] ?? { reads: "the prior .lane/ artifacts", writes: "the next .lane/ artifact" };
  return [
    `You are running the "${phase}" phase of the forge lane. No human is present.`,
    `Original request: ${ctx.request || "(none)"}`,
    skillNames.length
      ? `Use these skills for this phase: ${skillNames.join(", ")}.`
      : `No skill is mapped for this phase — do a built-in self-review pass.`,
    `Read: ${io.reads}.`,
    `Produce: ${io.writes}.`,
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
    "Constraints: AskUserQuestion is auto-answered by the operator judge per principles.md.",
    "All tools are available, including Bash. Keep changes scoped to the request.",
  ].join("\n");
}
