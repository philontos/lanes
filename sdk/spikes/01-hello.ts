import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const m of query({ prompt: "Say OK and nothing else.", options: { model: "haiku", allowedTools: [] } })) {
  if (m.type === "result") console.log("RESULT:", (m as any).subtype, JSON.stringify(m).slice(0, 300));
}
