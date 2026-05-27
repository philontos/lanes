import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { judge as defaultJudge, type AskQuestion, type JudgeResult } from "./judge.js";

type Result = { behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string };
interface Deps { judgeFn?: (q: AskQuestion[], p: string) => Promise<JudgeResult>; logPath?: string }

// Auto mode runs inside Docker — the container is the isolation boundary, so all
// tools are allowed. AskUserQuestion is still answered by the operator judge.
export function makeCanUseTool(principles: string, deps: Deps = {}) {
  const judgeFn = deps.judgeFn ?? defaultJudge;
  return async (toolName: string, input: any, _opts: unknown): Promise<Result> => {
    if (toolName === "AskUserQuestion") {
      const { answers, degraded } = await judgeFn(input.questions, principles);
      if (deps.logPath) {
        mkdirSync(dirname(deps.logPath), { recursive: true });
        const mark = degraded ? " ⚠ judge-fallback (model unreachable; safe defaults)" : "";
        appendFileSync(deps.logPath, `[ask]${mark} ${JSON.stringify(answers)}\n`);
      }
      return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
    }
    return { behavior: "allow", updatedInput: input };
  };
}
