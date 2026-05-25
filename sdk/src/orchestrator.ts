import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readState, writeState } from "./state.js";
import { resolveModel, resolveLimits, PHASES } from "./phases.js";
import { buildPhasePrompt } from "./prompts.js";
import { makeCanUseTool } from "./canUseTool.js";
import { formatMessage } from "./streamLog.js";

const SUPERPOWERS = `${process.env.HOME}/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0`;

export async function runPhase(opts: {
  worktreeDir: string; commandsDir: string; lane: string; phase: string; principlesPath: string;
}) {
  const laneDir = join(opts.worktreeDir, ".lane");
  const state = readState(laneDir);
  const skills = JSON.parse(readFileSync(join(opts.commandsDir, opts.lane, "skills.json"), "utf8"));
  const principles = readFileSync(opts.principlesPath, "utf8");
  let agentsMd = "";
  try { agentsMd = readFileSync(join(opts.worktreeDir, "AGENTS.md"), "utf8"); } catch { /* AGENTS.md optional */ }

  const prompt = buildPhasePrompt(opts.phase, { skills, request: String(state.request ?? ""), agentsMd });

  let result: any;
  for await (const m of query({
    prompt,
    options: {
      cwd: opts.worktreeDir,
      model: resolveModel(skills, opts.phase),
      ...resolveLimits(skills, opts.phase),
      permissionMode: "default",
      canUseTool: makeCanUseTool(principles, { logPath: join(laneDir, "decision-log.md") }),
      plugins: [{ type: "local", path: SUPERPOWERS }],
    },
  })) {
    for (const line of formatMessage(m)) console.log(line);
    if (m.type === "result") result = m;
  }
  return result;
}

// Drives the phase chain (one run = spec -> plan -> impl -> review). Each phase is
// a separate runPhase session; artifacts thread through .lane/. Stops on failure.
// Maintains the PROTOCOL state contract: phase, status, next, and append-only history.
export async function runLane(
  opts: { worktreeDir: string; commandsDir: string; lane: string; principlesPath: string; startPhase?: string },
  deps: { runPhase?: (o: any) => Promise<any> } = {},
) {
  const run = deps.runPhase ?? runPhase;
  const laneDir = join(opts.worktreeDir, ".lane");
  const startIdx = Math.max(0, PHASES.indexOf((opts.startPhase ?? PHASES[0]) as any));
  const chain = PHASES.slice(startIdx);
  let last: any;
  for (let i = 0; i < chain.length; i++) {
    const phase = chain[i];
    const next = chain[i + 1] ?? null;
    writeState(laneDir, { ...readState(laneDir), phase, status: "ok", next });
    last = await run({ worktreeDir: opts.worktreeDir, commandsDir: opts.commandsDir, lane: opts.lane, phase, principlesPath: opts.principlesPath });
    const cur = readState(laneDir);
    const ok = (last as any)?.subtype === "success";
    const history = [...((cur.history as any[]) ?? []), { phase, status: ok ? "ok" : "blocked", at: new Date().toISOString() }];
    if (!ok) {
      writeState(laneDir, { ...cur, phase, status: "blocked", next, history });
      return last;
    }
    writeState(laneDir, { ...cur, phase, status: "ok", next, history });
  }
  writeState(laneDir, { ...readState(laneDir), status: "done", next: null });
  return last;
}
