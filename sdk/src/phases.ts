// Pass the skills.json family alias ("opus"/"sonnet"/"haiku") straight through — the SDK
// accepts aliases; don't hardcode dated model ids (they go stale).
export function resolveModel(skills: any, phase: string): string {
  return skills?.models?.[phase]?.subagent ?? "sonnet";
}
