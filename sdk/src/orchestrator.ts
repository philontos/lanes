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
  rubricPath?: string; designPrinciplesPath?: string; reviewFeedback?: string[];
}) {
  const { abs: laneDir, rel: laneRel } = resolveLaneDir(opts.worktreeDir);
  const state = readState(laneDir);
  const config = JSON.parse(readFileSync(opts.configPath, "utf8"));
  const principles = readFileSync(opts.principlesPath, "utf8");
  let agentsMd = "";
  try { agentsMd = readFileSync(join(opts.worktreeDir, "AGENTS.md"), "utf8"); } catch { /* AGENTS.md optional */ }
  const readOptional = (p?: string) => { if (!p) return ""; try { return readFileSync(p, "utf8"); } catch { return ""; } };

  const prompt = buildPhasePrompt(opts.phase, {
    config, request: String(state.request ?? ""), agentsMd, laneRel,
    rubric: readOptional(opts.rubricPath),
    designPrinciples: readOptional(opts.designPrinciplesPath),
    reviewFeedback: opts.reviewFeedback,
  });

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

export interface Verdict { verdict: string; reasons: string[] }

// The review gate's verdict: review writes <laneDir>/verdict.json. A missing or
// unparseable file is treated as a pass (lenient — never hard-block on a read glitch;
// the gate's teeth are explicit "reject"s).
function defaultReadVerdict(laneDir: string): Verdict | null {
  try {
    const v = JSON.parse(readFileSync(join(laneDir, "verdict.json"), "utf8"));
    return { verdict: String(v.verdict), reasons: Array.isArray(v.reasons) ? v.reasons.map(String) : [] };
  } catch { return null; }
}

// How many times a "reject" verdict may bounce the cycle back to impl before it
// gives up and blocks. Constant for now; lift to config if it needs tuning.
const MAX_REVIEW_RETRIES = 2;

// Drives the phase chain (spec -> plan -> impl -> review) as a small state machine.
// Each phase is a separate runPhase session; artifacts thread through the cycle dir.
// The review gate can bounce a "reject" back to impl (with feedback) up to
// MAX_REVIEW_RETRIES times before blocking. Stops on any phase failure/throw.
// Maintains the PROTOCOL state contract: phase, status, next, append-only history.
export async function runLane(
  opts: { worktreeDir: string; configPath: string; principlesPath: string; rubricPath?: string; designPrinciplesPath?: string; startPhase?: string },
  deps: { runPhase?: (o: any) => Promise<any>; readVerdict?: (laneDir: string) => Verdict | null } = {},
) {
  const run = deps.runPhase ?? runPhase;
  const readVerdict = deps.readVerdict ?? defaultReadVerdict;
  const { abs: laneDir } = resolveLaneDir(opts.worktreeDir);
  // Per-model token usage accumulated across phases; reported once at the end.
  let usage: Record<string, ModelUsageTotals> = {};
  const reportUsage = () => { if (Object.keys(usage).length) console.log(formatUsageReport(usage)); };
  const now = () => new Date().toISOString();
  const appendHistory = (cur: any, entry: any) => [...((cur.history as any[]) ?? []), entry];

  let last: any;
  let reviewAttempts = 0;
  let feedback: string[] | undefined; // injected into the next impl run on a reject
  let idx = Math.max(0, PHASES.indexOf((opts.startPhase ?? PHASES[0]) as any));

  while (idx < PHASES.length) {
    const phase = PHASES[idx];
    const next = PHASES[idx + 1] ?? null;
    writeState(laneDir, { ...readState(laneDir), phase, status: "ok", next });

    // A phase can fail two ways: return a non-success result (below) or *throw*
    // (SDK/network/auth error, judge crash). Without this catch a throw would leave
    // state at the "ok" written just above — a crash recorded as success.
    try {
      last = await run({
        worktreeDir: opts.worktreeDir, configPath: opts.configPath, phase,
        principlesPath: opts.principlesPath, rubricPath: opts.rubricPath,
        designPrinciplesPath: opts.designPrinciplesPath,
        reviewFeedback: phase === "impl" ? feedback : undefined,
      });
    } catch (e) {
      const cur = readState(laneDir);
      writeState(laneDir, { ...cur, phase, status: "blocked", next, history: appendHistory(cur, { phase, status: "blocked", at: now(), error: String((e as any)?.message ?? e) }) });
      reportUsage();
      throw e;
    }

    usage = mergeModelUsage(usage, (last as any)?.modelUsage);
    const cur = readState(laneDir);
    const ok = (last as any)?.subtype === "success";
    const history = appendHistory(cur, { phase, status: ok ? "ok" : "blocked", at: now() });
    if (!ok) {
      writeState(laneDir, { ...cur, phase, status: "blocked", next, history });
      reportUsage();
      return last;
    }

    // Quality gate: a successful review session still has to clear the verdict.
    if (phase === "review") {
      const v = readVerdict(laneDir);
      if (v?.verdict === "reject") {
        if (reviewAttempts < MAX_REVIEW_RETRIES) {
          reviewAttempts++;
          feedback = v.reasons;
          writeState(laneDir, { ...cur, phase, status: "needs-review", next: "impl", history });
          idx = PHASES.indexOf("impl"); // bounce back to fix
          continue;
        }
        // retries exhausted — block the cycle (the review session itself was ok, so
        // history keeps {review, ok}; the block is at the gate level, with reasons).
        writeState(laneDir, { ...cur, phase, status: "blocked", next: null, history, gate: { verdict: "reject", reasons: v.reasons } });
        reportUsage();
        return last;
      }
    }

    writeState(laneDir, { ...cur, phase, status: "ok", next, history });
    idx++;
  }
  writeState(laneDir, { ...readState(laneDir), status: "done", next: null });
  reportUsage();
  return last;
}
