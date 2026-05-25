// Pass the skills.json family alias ("opus"/"sonnet"/"haiku") straight through — the SDK
// accepts aliases; don't hardcode dated model ids (they go stale).
export function resolveModel(skills: any, phase: string): string {
  return skills?.models?.[phase]?.subagent ?? "sonnet";
}

export const PHASES = ["spec", "plan", "impl", "review"] as const;

// Resolve a phase's skill(s) from skills.json: usage[phase] -> roles -> skills[role].
export function skillsForPhase(skills: any, phase: string): string[] {
  const roles: string[] = skills?.usage?.[phase] ?? [];
  return roles.map((r) => skills?.skills?.[r]).filter((s): s is string => typeof s === "string");
}

// Per-phase SDK guardrails from skills.json (limits[phase]). Only positive numbers
// apply; null/absent/non-positive means "no limit" so the field is omitted entirely.
export function resolveLimits(skills: any, phase: string): { maxTurns?: number; maxThinkingTokens?: number } {
  const l = skills?.limits?.[phase] ?? {};
  const out: { maxTurns?: number; maxThinkingTokens?: number } = {};
  if (typeof l.maxTurns === "number" && l.maxTurns > 0) out.maxTurns = l.maxTurns;
  if (typeof l.maxThinkingTokens === "number" && l.maxThinkingTokens > 0) out.maxThinkingTokens = l.maxThinkingTokens;
  return out;
}
