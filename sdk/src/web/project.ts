// Read one project's full state for the web. Reads the working tree's
// .lanes/* directly (no git show); see workspace.ts for rationale.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  readBacklog, readFeatures,
  type ProjectFeaturesFile, type ProjectBacklogFile,
} from "../project/state.js";
import { featureDisplayStatus, projectDisplayStatus, type DisplayStatus } from "../project/derive.js";

export interface CycleSummary {
  cycle_id: string;
  has_state: boolean;
  state_status?: string;        // from .lane/cycles/<id>/state.json if present
  state_phase?: string;
  state_request?: string;
  has_run_log: boolean;
}

export interface FeatureView {
  id: string;
  title: string;
  why: string;
  design_notes: string;
  lifecycle: "active" | "dropped";
  display_status: DisplayStatus;
}

export interface ItemView {
  id: string;
  title: string;
  feature_id: string;
  acceptance: string[];
  status: string;
  cycles: { cycle_id: string; verdict: string; at: string }[];
  notes: string;
  completed_at: string | null;
}

export interface ProjectView {
  name: string;
  path: string;
  display_status: DisplayStatus;
  summary_md: string;
  spec_md: string;
  plan_md: string;
  features: FeatureView[];
  items: ItemView[];
  recent_cycles: CycleSummary[];
}

// readProject returns the full view a Web frontend needs to render the
// 5-layer drill-down + recent cycles. Returns null when the project isn't
// initialised (.lanes/ absent) — the API layer translates that into a 404
// or "needs init" hint depending on context.
export function readProject(projectPath: string, name: string): ProjectView | null {
  const lanesDir = join(projectPath, ".lanes");
  if (!existsSync(lanesDir)) return null;

  const safeRead = (rel: string): string => {
    try { return readFileSync(join(projectPath, rel), "utf8"); } catch { return ""; }
  };
  const safeJson = <T>(reader: () => T, fallback: T): T => {
    try { return reader(); } catch { return fallback; }
  };

  const featuresFile: ProjectFeaturesFile = safeJson(
    () => readFeatures(projectPath), { next_id_seq: 1, features: [] },
  );
  const backlogFile: ProjectBacklogFile = safeJson(
    () => readBacklog(projectPath), { next_id_seq: 1, items: [] },
  );

  const features: FeatureView[] = featuresFile.features.map((f) => ({
    id: f.id, title: f.title, why: f.why, design_notes: f.design_notes,
    lifecycle: f.lifecycle,
    display_status: featureDisplayStatus(f, backlogFile.items),
  }));

  const items: ItemView[] = backlogFile.items.map((i) => ({
    id: i.id, title: i.title, feature_id: i.feature_id,
    acceptance: i.acceptance, status: i.status, cycles: i.cycles,
    notes: i.notes, completed_at: i.completed_at,
  }));

  return {
    name, path: projectPath,
    display_status: projectDisplayStatus(featuresFile.features, backlogFile.items),
    summary_md: safeRead(".lanes/summary.md"),
    spec_md: safeRead(".lanes/spec.md"),
    plan_md: safeRead(".lanes/plan.md"),
    features, items,
    recent_cycles: listRecentCycles(projectPath, 20),
  };
}

// listRecentCycles scans .lane/cycles/* and returns a small summary for each,
// sorted newest first by directory name (cycle-YYYYMMDD-HHMMSS sorts correctly).
export function listRecentCycles(projectPath: string, limit: number): CycleSummary[] {
  const cyclesDir = join(projectPath, ".lane", "cycles");
  if (!existsSync(cyclesDir)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(cyclesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) ids.push(entry.name);
  }
  ids.sort().reverse();
  return ids.slice(0, limit).map((cycle_id) => summariseCycle(projectPath, cycle_id));
}

export function summariseCycle(projectPath: string, cycle_id: string): CycleSummary {
  const dir = join(projectPath, ".lane", "cycles", cycle_id);
  const stateFile = join(dir, "state.json");
  const out: CycleSummary = {
    cycle_id,
    has_state: existsSync(stateFile),
    has_run_log: existsSync(join(dir, "run.log")),
  };
  if (out.has_state) {
    try {
      const s = JSON.parse(readFileSync(stateFile, "utf8"));
      out.state_status = String(s.status ?? "");
      out.state_phase = String(s.phase ?? "");
      if (typeof s.request === "string") out.state_request = s.request;
    } catch { /* ignore */ }
  }
  return out;
}

// Resolve a cycle directory and verify it's inside the expected project.
// Throws on directory traversal attempts.
export function cycleDirSafe(projectPath: string, cycle_id: string): string {
  if (!/^cycle-[A-Za-z0-9_-]+$/.test(cycle_id)) {
    throw new Error(`invalid cycle id: ${cycle_id}`);
  }
  const dir = join(projectPath, ".lane", "cycles", cycle_id);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`cycle ${cycle_id} not found`);
  }
  return dir;
}
