// Cycle spawn + live log streaming for the web. Web triggers a backlog item via
// POST /cycles; this module synthesizes the structured request from the item's
// project state, writes the cycle scratch (.lane/cycles/<id>/), pre-branches
// onto lanes/<cycle-id>, and spawns a Docker container that runs the existing
// orchestrator. Stdout/stderr from the container is broadcast to SSE subscribers
// AND tee'd into .lane/cycles/<id>/run.log (matches existing run-auto.sh).

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream, existsSync, readFileSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { synthesizeRequest } from "../../sdk/src/project/synthesize.js";

export interface SpawnEnv {
  workspaceHostPath: string;     // host filesystem path of workspace (passed to web container as env)
  repoHostPath: string;          // host path of the lanes repo (mounted /lanes in the cycle container)
  oauthToken: string;            // CLAUDE_CODE_OAUTH_TOKEN; required
  imageTag: string;              // "lanes-sdk-orchestrator:latest" by default
}

export interface SpawnResult {
  cycle_id: string;
  project: string;
}

// In-memory registry of live cycles. Each entry holds the child process plus a
// rolling buffer of recent lines so a late SSE subscriber can catch up without
// re-reading run.log. The buffer is capped to avoid unbounded memory growth.
interface LiveCycle {
  cycle_id: string;
  project: string;
  child: ChildProcess;
  subscribers: Set<(line: string) => void>;
  buffer: string[];
  ended: boolean;
  exit_code: number | null;
  log_stream: WriteStream;
}
const BUFFER_LIMIT = 500;
const live: Map<string, LiveCycle> = new Map();

export function listLiveCycles(): { cycle_id: string; project: string; ended: boolean; exit_code: number | null }[] {
  return [...live.values()].map((c) => ({
    cycle_id: c.cycle_id, project: c.project, ended: c.ended, exit_code: c.exit_code,
  }));
}

export function getLiveCycle(cycle_id: string): LiveCycle | null {
  return live.get(cycle_id) ?? null;
}

// Subscribe to a live cycle's output. Returns an unsubscribe function. The
// callback receives one "line or chunk" at a time; the existing buffer is
// flushed synchronously before the function returns so late joiners see the
// recent history without an extra round-trip.
export function subscribe(cycle_id: string, onLine: (s: string) => void): () => void {
  const c = live.get(cycle_id);
  if (!c) {
    // Cycle is no longer live (already exited). Caller should fall back to
    // reading .lane/cycles/<id>/run.log via the past-log endpoint.
    return () => {};
  }
  for (const past of c.buffer) onLine(past);
  c.subscribers.add(onLine);
  return () => { c.subscribers.delete(onLine); };
}

function formatCycleId(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `cycle-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-`
       + `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

// Spawn a forge cycle for the given backlog item. Throws on any setup error
// before the container is started; once started, errors stream to subscribers
// and the cycle ends with a non-zero exit_code.
export function spawnCycle(
  projectName: string,
  projectPath: string,
  itemId: string,
  env: SpawnEnv,
  now: () => Date = () => new Date(),
): SpawnResult {
  const request = synthesizeRequest(projectPath, itemId);
  return launchCycle({
    projectName, projectPath, env, now,
    state: { lane: "forge", phase: "spec", request, item_id: itemId },
    cmdArgs: ["/app/sdk/src/run.ts", "--auto", "/worktree", "forge", "spec"],
  });
}

// Spawn a shape cycle — updates .lanes/{summary,spec,features,plan} from the
// user's free-text intent + the current project state. Does NOT bind to a
// backlog item (item_id is absent), does NOT modify business code. The user
// reviews the cycle's branch and merges to apply.
export function spawnShapeCycle(
  projectName: string,
  projectPath: string,
  request: string,
  env: SpawnEnv,
  now: () => Date = () => new Date(),
): SpawnResult {
  if (!request.trim()) throw new Error("shape cycle needs a non-empty request");
  return launchCycle({
    projectName, projectPath, env, now,
    state: { lane: "shape", phase: "shape", request },
    cmdArgs: ["/app/sdk/src/run.ts", "--auto", "/worktree", "shape", "shape"],
  });
}

interface LaunchArgs {
  projectName: string;
  projectPath: string;
  env: SpawnEnv;
  now: () => Date;
  state: { lane: string; phase: string; request: string; item_id?: string };
  cmdArgs: string[];
}

// Shared launch path: cycle dir, pre-branch, state.json, docker run, live SSE
// tracking. The lane-specific bits are passed in (state extras + cmd args).
function launchCycle(p: LaunchArgs): SpawnResult {
  if (!p.env.oauthToken) throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required to spawn a cycle");

  const cycle_id = formatCycleId(p.now());
  const cycleDir = join(p.projectPath, ".lane", "cycles", cycle_id);
  if (existsSync(cycleDir)) throw new Error(`cycle id collision: ${cycle_id} already exists`);
  mkdirSync(cycleDir, { recursive: true });

  // Pre-branch onto lanes/<cycle-id>. If already on a lanes/ branch, stay put.
  const curBranch = getCurrentBranch(p.projectPath);
  if (!curBranch.startsWith("lanes/")) {
    const r = spawnSync("git", ["-C", p.projectPath, "checkout", "-q", "-b", `lanes/${cycle_id}`], { stdio: "ignore" });
    if (r.status !== 0) {
      spawnSync("git", ["-C", p.projectPath, "checkout", "-q", `lanes/${cycle_id}`], { stdio: "ignore" });
    }
  }

  const stateJson: Record<string, unknown> = {
    lane: p.state.lane, cycle_id, phase: p.state.phase, status: "ok",
    autonomy: "auto", request: p.state.request,
  };
  if (p.state.item_id) stateJson.item_id = p.state.item_id;
  writeFileSync(join(cycleDir, "state.json"), JSON.stringify(stateJson, null, 2));
  writeFileSync(join(p.projectPath, ".lane", "current-cycle"), cycle_id + "\n");

  // Compose docker run args. -v paths must be HOST paths (the docker daemon
  // resolves them; it doesn't see the web container's mount namespace).
  const projectHostPath = join(p.env.workspaceHostPath, p.projectName);
  const args = [
    "run", "--rm",
    "--label", `lanes.cycle=${cycle_id}`,
    "--label", `lanes.project=${p.projectName}`,
    "--label", `lanes.lane=${p.state.lane}`,
    "-e", "CLAUDE_CODE_OAUTH_TOKEN",
    "-e", "LANES_REPO=/lanes",
    "-v", `${p.env.repoHostPath}:/lanes:ro`,
    "-v", `${projectHostPath}:/worktree:rw`,
    p.env.imageTag,
    ...p.cmdArgs,
  ];
  const child = spawn("docker", args, {
    env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: p.env.oauthToken },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logStream = createWriteStream(join(cycleDir, "run.log"));
  const entry: LiveCycle = {
    cycle_id, project: p.projectName, child,
    subscribers: new Set(), buffer: [], ended: false, exit_code: null,
    log_stream: logStream,
  };
  live.set(cycle_id, entry);

  const onChunk = (data: Buffer) => {
    const text = data.toString();
    logStream.write(data);
    entry.buffer.push(text);
    if (entry.buffer.length > BUFFER_LIMIT) entry.buffer.shift();
    for (const sub of entry.subscribers) {
      try { sub(text); } catch { /* swallow — subscriber crashed */ }
    }
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);

  child.on("exit", (code) => {
    entry.ended = true;
    entry.exit_code = code;
    logStream.end();
    const tail = `\n[cycle ended with exit code ${code}]\n`;
    entry.buffer.push(tail);
    for (const sub of entry.subscribers) {
      try { sub(tail); } catch { /* */ }
    }
    // Keep entry in `live` for ~5 minutes so late SSE joiners can still get the
    // tail; after that, callers fall back to run.log.
    setTimeout(() => { live.delete(cycle_id); }, 5 * 60 * 1000);
  });

  return { cycle_id, project: p.projectName };
}

function getCurrentBranch(projectPath: string): string {
  const r = spawnSync("git", ["-C", projectPath, "symbolic-ref", "--short", "-q", "HEAD"], { encoding: "utf8" });
  return (r.stdout || "").trim();
}

// Read a past cycle's run.log when it's no longer live. Returns "" when absent.
export function readCycleLog(cycleDir: string): string {
  const f = join(cycleDir, "run.log");
  try { return readFileSync(f, "utf8"); } catch { return ""; }
}
