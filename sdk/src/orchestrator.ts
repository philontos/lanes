import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readState, writeState } from "./state.js";
import { resolveModel, resolveLimits, PHASES } from "./phases.js";
import { buildPhasePrompt } from "./prompts.js";
import { makeCanUseTool } from "./canUseTool.js";
import { formatMessage } from "./streamLog.js";
import { mergeModelUsage, formatUsageReport, type ModelUsageTotals } from "./usage.js";
import { resolvePlugins, assertSkillsInstalled } from "./plugins.js";

// The active cycle's lane dir, resolved from the .lane/current-cycle pointer that
// bootstrap writes. Each cycle is born isolated under .lane/cycles/<id>/, so the
// phases of one run share a dir while never bleeding across cycles. Fail loud if the
// pointer is absent — a run with no cycle to write into must not silently fall back.
function resolveLaneDir(worktreeDir: string): { abs: string; rel: string } {
  const pointer = join(worktreeDir, ".lane", "current-cycle");
  let cycleId = "";
  try { cycleId = readFileSync(pointer, "utf8").trim(); }
  catch { throw new Error(`missing .lane/current-cycle in ${worktreeDir} — bootstrap must write the active cycle pointer before a run`); }
  if (!cycleId) throw new Error(`empty .lane/current-cycle in ${worktreeDir}`);
  const rel = join(".lane", "cycles", cycleId);
  return { abs: join(worktreeDir, rel), rel };
}

export async function runPhase(opts: {
  worktreeDir: string; configPath: string; phase: string; principlesPath: string;
}) {
  const { abs: laneDir, rel: laneRel } = resolveLaneDir(opts.worktreeDir);
  const state = readState(laneDir);
  const config = JSON.parse(readFileSync(opts.configPath, "utf8"));
  const principles = readFileSync(opts.principlesPath, "utf8");
  let agentsMd = "";
  try { agentsMd = readFileSync(join(opts.worktreeDir, "AGENTS.md"), "utf8"); } catch { /* AGENTS.md optional */ }

  const prompt = buildPhasePrompt(opts.phase, { config, request: String(state.request ?? ""), agentsMd, laneRel });

  // Load every declared plugin and fail loud if config names a skill none provide.
  const plugins = resolvePlugins();
  assertSkillsInstalled(config, plugins);

  let result: any;
  for await (const m of query({
    prompt,
    options: {
      cwd: opts.worktreeDir,
      model: resolveModel(config, opts.phase),
      ...resolveLimits(config, opts.phase),
      permissionMode: "default",
      canUseTool: makeCanUseTool(principles, { logPath: join(laneDir, "decision-log.md") }),
      plugins,
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
  const { abs: laneDir } = resolveLaneDir(opts.worktreeDir);
  const startIdx = Math.max(0, PHASES.indexOf((opts.startPhase ?? PHASES[0]) as any));
  const chain = PHASES.slice(startIdx);
  let last: any;
  // Per-model token usage accumulated across the phase chain (from each phase's
  // result.modelUsage); reported once at the end so a whole run's spend by model
  // lands in the log.
  let usage: Record<string, ModelUsageTotals> = {};
  const reportUsage = () => { if (Object.keys(usage).length) console.log(formatUsageReport(usage)); };
  for (let i = 0; i < chain.length; i++) {
    const phase = chain[i];
    const next = chain[i + 1] ?? null;
    writeState(laneDir, { ...readState(laneDir), phase, status: "ok", next });
    // A phase can fail two ways: return a non-success result (handled below) or
    // *throw* (SDK/network/auth error, judge crash, …). Without this catch a throw
    // would leave state at the "ok" written just above and skip the history entry —
    // a crash recorded as success. Mark blocked + record, then rethrow so run.ts
    // still exits non-zero.
    try {
      last = await run({ worktreeDir: opts.worktreeDir, configPath: opts.configPath, phase, principlesPath: opts.principlesPath });
    } catch (e) {
      const cur = readState(laneDir);
      const history = [...((cur.history as any[]) ?? []), { phase, status: "blocked", at: new Date().toISOString(), error: String((e as any)?.message ?? e) }];
      writeState(laneDir, { ...cur, phase, status: "blocked", next, history });
      reportUsage();
      throw e;
    }
    usage = mergeModelUsage(usage, (last as any)?.modelUsage);
    const cur = readState(laneDir);
    const ok = (last as any)?.subtype === "success";
    const history = [...((cur.history as any[]) ?? []), { phase, status: ok ? "ok" : "blocked", at: new Date().toISOString() }];
    if (!ok) {
      writeState(laneDir, { ...cur, phase, status: "blocked", next, history });
      reportUsage();
      return last;
    }
    writeState(laneDir, { ...cur, phase, status: "ok", next, history });
  }
  writeState(laneDir, { ...readState(laneDir), status: "done", next: null });
  reportUsage();
  return last;
}
