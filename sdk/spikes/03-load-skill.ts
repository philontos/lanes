import { query } from "@anthropic-ai/claude-agent-sdk";
const SUPERPOWERS = `${process.env.HOME}/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0`;
for await (const m of query({
  prompt: "What skills are available? Just list them.",
  options: { plugins: [{ type: "local", path: SUPERPOWERS }] },
})) {
  if (m.type === "system" && (m as any).subtype === "init")
    console.log("INIT slash_commands:", JSON.stringify((m as any).slash_commands));
  if (m.type === "result") console.log("RESULT:", (m as any).subtype);
}
