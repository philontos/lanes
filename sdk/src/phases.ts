// Lane = a fixed phase sequence. `forge` builds code from a backlog item;
// `shape` updates the project-level .lanes/* docs from user intent. Adding a
// new lane = add an entry here + its phase prompts in prompts.ts + its config
// in lanes.config.json. The orchestrator stays lane-agnostic.

export const LANES = {
  forge: ["spec", "plan", "impl", "review", "reflect"],
  init: ["init"],
  reshape: ["reshape"],
} as const;

export type LaneName = keyof typeof LANES;
export type PhaseName = typeof LANES[LaneName][number];

// Legacy export — pre-existing callers used PHASES as the canonical phase list.
// Kept pointing at forge for backward compat with anything that imports it.
export const PHASES = LANES.forge;

export function phasesForLane(lane: string): readonly string[] {
  return (LANES as Record<string, readonly string[]>)[lane] ?? LANES.forge;
}

function phaseCfg(config: any, phase: string): any {
  return config?.phases?.[phase] ?? {};
}

// Model family alias ("opus"/"sonnet"/"haiku") for the phase; SDK accepts aliases.
export function resolveModel(config: any, phase: string): string {
  return phaseCfg(config, phase).model ?? "sonnet";
}

// The phase's skill(s): `skills` array or single `skill`, filtered to strings.
export function skillsForPhase(config: any, phase: string): string[] {
  const c = phaseCfg(config, phase);
  const raw = Array.isArray(c.skills) ? c.skills : c.skill != null ? [c.skill] : [];
  return raw.filter((s: unknown): s is string => typeof s === "string");
}

// Per-phase SDK guardrails. Only positive numbers apply; otherwise the field is
// omitted so the SDK stays unbounded.
export function resolveLimits(config: any, phase: string): { maxTurns?: number; maxThinkingTokens?: number } {
  const c = phaseCfg(config, phase);
  const out: { maxTurns?: number; maxThinkingTokens?: number } = {};
  if (typeof c.maxTurns === "number" && c.maxTurns > 0) out.maxTurns = c.maxTurns;
  if (typeof c.maxThinkingTokens === "number" && c.maxThinkingTokens > 0) out.maxThinkingTokens = c.maxThinkingTokens;
  return out;
}
