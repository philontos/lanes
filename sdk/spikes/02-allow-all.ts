import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const m of query({
  prompt: "List the files in the current directory using the Bash tool, then stop.",
  options: {
    permissionMode: "default",
    canUseTool: async (toolName, input) => {
      console.error("CANUSE:", toolName, JSON.stringify(input).slice(0, 120));
      return { behavior: "allow", updatedInput: input };
    },
  },
})) {
  if (m.type === "result") console.log("RESULT:", (m as any).subtype);
}
