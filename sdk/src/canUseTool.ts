import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { judge as defaultJudge, type Answers, type AskQuestion } from "./judge.js";

type Result = { behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string };
interface Deps { judgeFn?: (q: AskQuestion[], p: string) => Promise<Answers>; logPath?: string }

// Auto mode runs inside Docker — the container is the isolation boundary, so all
// tools are allowed. AskUserQuestion is still answered by the operator judge.
export function makeCanUseTool(principles: string, deps: Deps = {}) {
  const judgeFn = deps.judgeFn ?? defaultJudge;
  return async (toolName: string, input: any, _opts: unknown): Promise<Result> => {
    if (toolName === "AskUserQuestion") {
      const answers = await judgeFn(input.questions, principles);
      if (deps.logPath) {
        mkdirSync(dirname(deps.logPath), { recursive: true });
        appendFileSync(deps.logPath, `[ask] ${JSON.stringify(answers)}\n`);
      }
      return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
    }
    return { behavior: "allow", updatedInput: input };
  };
}
