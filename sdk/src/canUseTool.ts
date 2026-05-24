import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { judge as defaultJudge, type Answers, type AskQuestion } from "./judge.js";

type Result = { behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string };
interface Deps { judgeFn?: (q: AskQuestion[], p: string) => Promise<Answers>; logPath?: string; }

// MVP: spec phase only needs file read/write + asking. Everything else (incl. destructive Bash)
// is denied — host-safety fallback before Docker isolation exists.
const SAFE = new Set(["Read", "Edit", "Write", "Grep", "Glob", "TodoWrite"]);

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
    if (SAFE.has(toolName)) return { behavior: "allow", updatedInput: input };
    return { behavior: "deny", message: `MVP: ${toolName} disabled on host run — use Read/Edit/Write/Grep/Glob (e.g. Glob instead of Bash find)` };
  };
}
