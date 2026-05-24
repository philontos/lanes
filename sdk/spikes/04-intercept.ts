import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const m of query({
  prompt:
    "Use the AskUserQuestion tool to ask me ONE question with 2 options (labels 'A' and 'B'), " +
    "then tell me which label I chose and stop.",
  options: {
    permissionMode: "default",
    canUseTool: async (toolName, input: any) => {
      if (toolName === "AskUserQuestion") {
        console.error("INTERCEPTED questions:", JSON.stringify(input.questions));
        const answers: Record<string, string> = {};
        for (const q of input.questions) answers[q.question] = q.options[0].label;
        return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
      }
      return { behavior: "allow", updatedInput: input };
    },
  },
})) {
  if (m.type === "result") console.log("RESULT:", (m as any).subtype, (m as any).result);
}
