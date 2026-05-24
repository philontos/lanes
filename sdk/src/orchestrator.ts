import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readState } from "./state.js";
import { resolveModel } from "./phases.js";
import { makeCanUseTool } from "./canUseTool.js";

const SUPERPOWERS = `${process.env.HOME}/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0`;

// MVP uses a purpose-built spec instruction — NOT the raw forge/spec.md (which is coupled to the
// CLI self-chain harness and would misfire in a standalone query). Reading a stripped .md to reuse
// phase logic is deferred to the full-loop plan.
function buildSpecPrompt(request: string, agentsMd: string): string {
  return [
    "用 superpowers:brainstorming skill，为下面的需求产出一份 spec。",
    `需求：${request}`,
    "=== 本仓库 AGENTS.md（硬约束）===", agentsMd || "(无)",
    "约束：",
    "- 没有人类在场。skill 需要确认/选择时照常用 AskUserQuestion——会被按操作者原则自动作答。",
    "- 本 MVP 只开放 Read/Edit/Write/Grep/Glob；**Bash 已禁用**，找文件用 Glob、搜内容用 Grep。",
    "- 最终把 spec 写到 `.lane/spec.md`，含：goal、scope(in/out)、要改的文件、成功标准、风险。",
  ].join("\n");
}

export async function runPhase(opts: {
  worktreeDir: string; commandsDir: string; lane: string; phase: string; principlesPath: string;
}) {
  const laneDir = join(opts.worktreeDir, ".lane");
  const state = readState(laneDir);
  const skills = JSON.parse(readFileSync(join(opts.commandsDir, opts.lane, "skills.json"), "utf8"));
  const principles = readFileSync(opts.principlesPath, "utf8");
  let agentsMd = "";
  try { agentsMd = readFileSync(join(opts.worktreeDir, "AGENTS.md"), "utf8"); } catch { /* AGENTS.md optional */ }

  // MVP only implements the spec phase; other phases' prompts come in a later plan.
  const prompt = buildSpecPrompt(String(state.request ?? ""), agentsMd);

  let result: any;
  for await (const m of query({
    prompt,
    options: {
      cwd: opts.worktreeDir,
      model: resolveModel(skills, opts.phase),
      permissionMode: "default",
      canUseTool: makeCanUseTool(principles, { logPath: join(laneDir, "decision-log.md"), denyLogPath: join(laneDir, "denied-tools.log") }),
      plugins: [{ type: "local", path: SUPERPOWERS }],
    },
  })) {
    if (m.type === "result") result = m;
  }
  return result;
}
