import { query } from "@anthropic-ai/claude-agent-sdk";

export interface AskQuestion {
  question: string; header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}
export type Answers = Record<string, string>;
export type AskModel = (prompt: string) => Promise<string>;

export function buildJudgePrompt(questions: AskQuestion[], principles: string): string {
  return [
    "你在替缺席的操作者做选择。只依据下面的原则判断。",
    "=== 原则 ===", principles,
    "=== 待答问题（JSON）===", JSON.stringify(questions, null, 2),
    "对每个问题，从它的 options.label 里选一个最符合原则的。",
    '只输出 JSON：{"answers":{"<question 原文>":"<选中的 label>"}}，不要别的。',
  ].join("\n");
}

export function parseAnswers(raw: string, questions: AskQuestion[]): Answers {
  const out: Answers = {};
  let parsed: any = {};
  try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { /* fall through */ }
  for (const q of questions) {
    const picked = parsed?.answers?.[q.question];
    const valid = q.options.some((o) => o.label === picked);
    out[q.question] = valid ? picked : q.options[0].label; // invalid/uncovered -> first option (safest default)
  }
  return out;
}

const defaultAsk: AskModel = async (prompt) => {
  let text = "";
  for await (const m of query({ prompt, options: { model: "sonnet", allowedTools: [] } })) {
    if (m.type === "result" && (m as any).subtype === "success") text = (m as any).result;
  }
  return text;
};

export async function judge(questions: AskQuestion[], principles: string, ask: AskModel = defaultAsk): Promise<Answers> {
  const raw = await ask(buildJudgePrompt(questions, principles));
  return parseAnswers(raw, questions);
}
