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
