import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readState, writeState } from "./state.js";
import { resolveModel, resolveLimits, PHASES } from "./phases.js";
import { buildPhasePrompt } from "./prompts.js";
import { makeCanUseTool } from "./canUseTool.js";
import { formatMessage } from "./streamLog.js";

// Resolve the superpowers plugin path (mounted from the host) without pinning a
// version: pick the highest version dir that actually contains skills/. Fail loudly
// if absent — the skills each phase invokes live here; a missing plugin = silent no-op.
function resolveSuperpowers(): string {
  const cache = `${process.env.HOME}/.claude/plugins/cache`;
  const candidates: string[] = [];
  if (existsSync(cache)) {
    for (const mkt of readdirSync(cache)) {                 // any marketplace
      const spDir = join(cache, mkt, "superpowers");
      if (!existsSync(spDir)) continue;
      for (const ver of readdirSync(spDir)) {               // any version
        if (existsSync(join(spDir, ver, "skills"))) candidates.push(join(spDir, ver));
      }
    }
  }
  candidates.sort();
  if (!candidates.length) {
    throw new Error(`superpowers plugin not found under ${cache}/*/superpowers — install it (claude plugin install superpowers@claude-plugins-official)`);
  }
  return candidates[candidates.length - 1];
}

export async function runPhase(opts: {
  worktreeDir: string; configPath: string; phase: string; principlesPath: string;
}) {
  const laneDir = join(opts.worktreeDir, ".lane");
  const state = readState(laneDir);
  const config = JSON.parse(readFileSync(opts.configPath, "utf8"));
  const principles = readFileSync(opts.principlesPath, "utf8");
  let agentsMd = "";
  try { agentsMd = readFileSync(join(opts.worktreeDir, "AGENTS.md"), "utf8"); } catch { /* AGENTS.md optional */ }

  const prompt = buildPhasePrompt(opts.phase, { config, request: String(state.request ?? ""), agentsMd });

  let result: any;
  for await (const m of query({
    prompt,
    options: {
      cwd: opts.worktreeDir,
      model: resolveModel(config, opts.phase),
      ...resolveLimits(config, opts.phase),
      permissionMode: "default",
      canUseTool: makeCanUseTool(principles, { logPath: join(laneDir, "decision-log.md") }),
      plugins: [{ type: "local", path: resolveSuperpowers() }],
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
  opts: { worktreeDir: string; configPath: string; principlesPath: string; startPhase?: string },
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
    last = await run({ worktreeDir: opts.worktreeDir, configPath: opts.configPath, phase, principlesPath: opts.principlesPath });
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
