// Local read-write web for the lanes platform. Plain Node http; no framework,
// no extra deps — everything the web needs lives in the existing sdk image.
//
// Endpoints
//   GET  /                                  index.html (SPA shell)
//   GET  /app.js | /style.css               static SPA assets
//   GET  /api/workspace                     { workspace, projects[] }
//   POST /api/projects/import { url }       git clone into workspace
//   POST /api/projects/:name/init           scaffold .lanes/
//   GET  /api/projects/:name                full project view (5 layers + cycles)
//   POST /api/projects/:name/cycles         { item_id } → spawn cycle, returns { cycle_id }
//   GET  /api/projects/:name/cycles/:id/stream     SSE live stdout
//   GET  /api/projects/:name/cycles/:id/log        plain text past log

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";
import {
  DEFAULT_WORKSPACE, listProjects, importProject,
  isWorkspaceProject, projectPath,
} from "./workspace.js";
import { readProject, cycleDirSafe, summariseCycle } from "./project.js";
import { spawnCycle, spawnInitCycle, spawnReshapeCycle, subscribe, listLiveCycles, getLiveCycle, readCycleLog } from "./cycles.js";
import { buildPulse } from "./pulse.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Static assets live next to src/, not inside it (web/static/ at the package root).
const STATIC_DIR = resolve(join(HERE, "..", "static"));
const PORT = Number(process.env.LANES_WEB_PORT || 7777);
const WORKSPACE = process.env.LANES_WORKSPACE || DEFAULT_WORKSPACE;
const WORKSPACE_HOST = process.env.LANES_WORKSPACE_HOST || WORKSPACE;
const REPO_HOST = process.env.LANES_REPO_HOST || process.env.LANES_REPO || "/lanes";
const IMAGE_TAG = process.env.LANES_SDK_IMAGE || "lanes-sdk-orchestrator:latest";
const OAUTH = process.env.CLAUDE_CODE_OAUTH_TOKEN || "";

if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}
function sendText(res: ServerResponse, status: number, text: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}
function notFound(res: ServerResponse): void { sendJson(res, 404, { error: "not found" }); }
function badRequest(res: ServerResponse, msg: string): void { sendJson(res, 400, { error: msg }); }
function serverError(res: ServerResponse, e: unknown): void {
  sendJson(res, 500, { error: String((e as any)?.message ?? e) });
}

async function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return await new Promise((resolveBody, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson<T = any>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  if (!raw) return {} as T;
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("invalid JSON body"); }
}

// ── Static files ─────────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
};

async function serveStatic(res: ServerResponse, relPath: string): Promise<boolean> {
  // Defend against directory traversal: resolve, then check it stays under STATIC_DIR.
  const abs = resolve(join(STATIC_DIR, relPath));
  if (!abs.startsWith(STATIC_DIR)) return false;
  try {
    const s = await stat(abs);
    if (!s.isFile()) return false;
    const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
    const body = await readFile(abs);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": s.size });
    res.end(body);
    return true;
  } catch { return false; }
}

// ── Route handlers ───────────────────────────────────────────────────────────
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const method = req.method || "GET";
  const path = url.pathname;

  // Static / index
  if (method === "GET" && (path === "/" || path === "/index.html")) {
    if (await serveStatic(res, "index.html")) return;
    return notFound(res);
  }
  if (method === "GET" && (path === "/app.js" || path === "/style.css")) {
    if (await serveStatic(res, path.slice(1))) return;
    return notFound(res);
  }

  // ── Workspace ─────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/workspace") {
    return sendJson(res, 200, { workspace: WORKSPACE, projects: listProjects(WORKSPACE) });
  }
  if (method === "POST" && path === "/api/projects/import") {
    try {
      const body = await readJson<{ url?: string }>(req);
      if (!body.url) return badRequest(res, "missing 'url'");
      const r = importProject(WORKSPACE, body.url);
      return sendJson(res, 200, r);
    } catch (e) { return serverError(res, e); }
  }

  // ── Per-project routes: /api/projects/:name[/...] ─────────────────────────
  const m = /^\/api\/projects\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (m) {
    const name = decodeURIComponent(m[1]);
    const sub = m[2] ?? "";
    if (!isWorkspaceProject(WORKSPACE, name)) return notFound(res);
    const pPath = projectPath(WORKSPACE, name);

    if (method === "POST" && sub === "init") {
      try {
        const body = await readJson<{ request?: string; mode?: string }>(req);
        if (!OAUTH) return sendJson(res, 503, { error: "CLAUDE_CODE_OAUTH_TOKEN not set in server env" });
        const mode: "first" | "overwrite" = body.mode === "overwrite" ? "overwrite" : "first";
        const r = spawnInitCycle(name, pPath, (body.request ?? "").trim(), {
          workspaceHostPath: WORKSPACE_HOST,
          repoHostPath: REPO_HOST,
          oauthToken: OAUTH,
          imageTag: IMAGE_TAG,
        }, mode);
        return sendJson(res, 200, r);
      } catch (e) { return serverError(res, e); }
    }
    if (method === "GET" && sub === "") {
      const v = readProject(pPath, name);
      if (!v) return sendJson(res, 200, { name, path: pPath, uninitialised: true });
      return sendJson(res, 200, v);
    }
    if (method === "GET" && sub === "pulse") {
      try { return sendJson(res, 200, buildPulse(name, pPath)); }
      catch (e) { return serverError(res, e); }
    }
    if (method === "POST" && sub === "cycles") {
      try {
        const body = await readJson<{ item_id?: string }>(req);
        if (!body.item_id) return badRequest(res, "missing 'item_id'");
        if (!OAUTH) return sendJson(res, 503, { error: "CLAUDE_CODE_OAUTH_TOKEN not set in server env" });
        const r = spawnCycle(name, pPath, body.item_id, {
          workspaceHostPath: WORKSPACE_HOST,
          repoHostPath: REPO_HOST,
          oauthToken: OAUTH,
          imageTag: IMAGE_TAG,
        });
        return sendJson(res, 200, r);
      } catch (e) { return serverError(res, e); }
    }
    if (method === "GET" && sub === "cycles") {
      // Combine live + on-disk summaries (live first).
      const liveCycles = listLiveCycles().filter((c) => c.project === name);
      const proj = readProject(pPath, name);
      const recent = proj?.recent_cycles ?? [];
      return sendJson(res, 200, { live: liveCycles, recent });
    }
    if (method === "POST" && sub === "reshape") {
      try {
        const body = await readJson<{ request?: string }>(req);
        if (!body.request || !body.request.trim()) return badRequest(res, "missing 'request'");
        if (!OAUTH) return sendJson(res, 503, { error: "CLAUDE_CODE_OAUTH_TOKEN not set in server env" });
        const r = spawnReshapeCycle(name, pPath, body.request.trim(), {
          workspaceHostPath: WORKSPACE_HOST,
          repoHostPath: REPO_HOST,
          oauthToken: OAUTH,
          imageTag: IMAGE_TAG,
        });
        return sendJson(res, 200, r);
      } catch (e) { return serverError(res, e); }
    }

    // /cycles/:id/stream  or  /cycles/:id/log
    const cm = /^cycles\/([A-Za-z0-9_-]+)(?:\/(stream|log))?$/.exec(sub);
    if (cm) {
      const cycle_id = cm[1];
      const what = cm[2] ?? "";
      if (method === "GET" && what === "stream") {
        return handleStream(res, name, pPath, cycle_id);
      }
      if (method === "GET" && what === "log") {
        try {
          const dir = cycleDirSafe(pPath, cycle_id);
          return sendText(res, 200, readCycleLog(dir));
        } catch (e) { return serverError(res, e); }
      }
      if (method === "GET" && what === "") {
        try {
          const _dir = cycleDirSafe(pPath, cycle_id);
          return sendJson(res, 200, summariseCycle(pPath, cycle_id));
        } catch (e) { return serverError(res, e); }
      }
    }
  }

  notFound(res);
}

// ── SSE stream ───────────────────────────────────────────────────────────────
// Stream live cycle output as Server-Sent Events. When the cycle isn't live
// anymore, we send a single one-shot dump of run.log and close.
function handleStream(res: ServerResponse, name: string, pPath: string, cycle_id: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  // disable buffering on intermediaries (nginx etc.)
  });
  const writeEvent = (event: string, data: string): void => {
    res.write(`event: ${event}\n`);
    // Each line in the data field must be prefixed with `data: ` per SSE spec.
    for (const line of data.split("\n")) res.write(`data: ${line}\n`);
    res.write("\n");
  };

  const live = getLiveCycle(cycle_id);
  if (!live) {
    // Not live — emit the past log once and close.
    try {
      const dir = cycleDirSafe(pPath, cycle_id);
      const log = readCycleLog(dir);
      if (log) writeEvent("log", log);
      writeEvent("end", "cycle is not live; serving past log only");
    } catch (e) {
      writeEvent("error", String((e as any)?.message ?? e));
    }
    res.end();
    return;
  }

  const unsub = subscribe(cycle_id, (chunk) => writeEvent("log", chunk));

  // Send periodic heartbeat to keep the connection through proxies.
  const heartbeat = setInterval(() => { res.write(": hb\n\n"); }, 15_000);

  res.on("close", () => { unsub(); clearInterval(heartbeat); });

  // If the cycle ends, close after the buffered tail flushes.
  live.child.on("exit", () => {
    writeEvent("end", `exit_code=${live.exit_code}`);
    setTimeout(() => res.end(), 100);
  });
}

// ── Entry ────────────────────────────────────────────────────────────────────
export function startServer(): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => serverError(res, e));
  });
  server.listen(PORT, () => {
    console.log(`lanes web listening on http://localhost:${PORT}`);
    console.log(`  workspace:        ${WORKSPACE}`);
    console.log(`  workspace (host): ${WORKSPACE_HOST}`);
    console.log(`  image:            ${IMAGE_TAG}`);
    if (!OAUTH) {
      console.log(`  NOTE: CLAUDE_CODE_OAUTH_TOKEN not set — running cycles will fail. Run setup.sh first.`);
    }
  });
}

// The explicit entry is web/src/run.ts; this module only exports startServer.
