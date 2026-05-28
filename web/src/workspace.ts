// Workspace: a single directory (default ~/lanes-workspace) whose immediate
// subdirectories are projects. Each project = one git repo. Status comes from
// reading the project's working tree — we deliberately do NOT use `git show
// main:.lanes/*` so freshly-cloned non-main repos and in-flight branches both
// display naturally. Strict "main view" can be a v2 toggle if it becomes
// painful.
//
// Project classification:
//   "uninitialised" — has .git/ but no .lanes/  → user can run init from web
//   "initialised"   — has .git/ AND .lanes/     → drill-down view is available

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

export const DEFAULT_WORKSPACE = process.env.LANES_WORKSPACE || join(homedir(), "lanes-workspace");

export type ProjectClass = "uninitialised" | "initialised";

export interface WorkspaceProject {
  name: string;          // directory name under the workspace
  path: string;          // absolute path
  class: ProjectClass;
  summary?: string;      // first non-empty paragraph of summary.md, when initialised
}

// Snapshot of the workspace contents — a fresh fs read each call (no cache).
// Subdirectories without a .git/ are skipped entirely (not "projects" in our model).
export function listProjects(workspaceDir: string = DEFAULT_WORKSPACE): WorkspaceProject[] {
  if (!existsSync(workspaceDir)) return [];
  const out: WorkspaceProject[] = [];
  for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(workspaceDir, entry.name);
    if (!existsSync(join(path, ".git"))) continue;
    const isInit = existsSync(join(path, ".lanes"));
    out.push({
      name: entry.name,
      path,
      class: isInit ? "initialised" : "uninitialised",
      summary: isInit ? safeSummary(path) : undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function safeSummary(projectPath: string): string {
  try {
    const md = readFileSync(join(projectPath, ".lanes", "summary.md"), "utf8");
    // Drop the leading # heading line(s); return the first non-empty paragraph.
    const body = md.replace(/^#.*$/gm, "").trim();
    const para = body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? "";
    return para.trim();
  } catch { return ""; }
}

// Import: shallow `git clone <url>` into the workspace. The target directory
// name is derived from the URL (last path segment, .git suffix stripped).
// Fails loud on: workspace doesn't exist (caller should create), target name
// collision, or git clone non-zero exit.
export interface ImportResult { name: string; path: string }

export function importProject(workspaceDir: string, url: string): ImportResult {
  if (!existsSync(workspaceDir)) {
    throw new Error(`workspace dir ${workspaceDir} does not exist`);
  }
  const name = deriveProjectName(url);
  if (!name) throw new Error(`could not derive a project name from URL: ${url}`);
  const path = join(workspaceDir, name);
  if (existsSync(path)) {
    throw new Error(`a project named '${name}' already exists in the workspace`);
  }
  const r = spawnSync("git", ["clone", "--quiet", url, path], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git clone failed: ${r.stderr.trim() || `exit ${r.status}`}`);
  }
  return { name, path };
}

// Extract a sensible project name from a git URL:
//   https://github.com/foo/bar       -> bar
//   https://github.com/foo/bar.git   -> bar
//   git@github.com:foo/bar.git       -> bar
//   /local/path/to/repo              -> repo
//   /local/path/to/repo.git          -> repo
export function deriveProjectName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const tail = trimmed.split(/[\/:]/).pop() || "";
  return tail.replace(/\.git$/i, "");
}

export function projectPath(workspaceDir: string, name: string): string {
  return join(workspaceDir, name);
}

// True when path is a directory and a git repo. Used at API boundaries to
// translate "unknown project name" into a 404 cleanly.
export function isWorkspaceProject(workspaceDir: string, name: string): boolean {
  const p = join(workspaceDir, name);
  if (!existsSync(p)) return false;
  try { return statSync(p).isDirectory() && existsSync(join(p, ".git")); }
  catch { return false; }
}
