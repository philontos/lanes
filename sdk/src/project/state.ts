// Read/write the five-layer project state at <repo>/.lanes/*. Schemas are typed
// here; persistence is whole-file overwrite (matches sdk/src/state.ts convention).
// The .lanes/ dir is created by `lanes init`; these helpers assume it exists and
// throw on missing files — fail loud beats silent fallback per project conventions.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LANES_DIR = ".lanes";

export function lanesDir(repoRoot: string): string {
  return join(repoRoot, LANES_DIR);
}

// ── Feature ────────────────────────────────────────────────────────────────
export interface ProjectFeature {
  id: string;              // "feature-NNNN" (see ids.ts)
  title: string;
  why: string;
  design_notes: string;    // cycle may append on its branch (see PROTOCOL)
  lifecycle: "active" | "dropped";  // intentionally not "status" — display status is derived
  superseded_by: string | null;
  created_at: string;      // ISO 8601
}

export interface ProjectFeaturesFile {
  next_id_seq: number;     // monotonic; pre-allocates next feature ID
  features: ProjectFeature[];
}

// ── Item ────────────────────────────────────────────────────────────────────
export type ItemStatus = "todo" | "in-progress" | "done" | "blocked" | "dropped";

export interface ProjectItemCycleRef {
  cycle_id: string;
  verdict: string;         // "pass" | "reject" | etc — kept as string for forward-compat
  at: string;              // ISO 8601
}

export interface ProjectItem {
  id: string;              // "item-NNNN"
  title: string;
  feature_id: string;
  acceptance: string[];
  status: ItemStatus;
  cycles: ProjectItemCycleRef[];
  notes: string;
  superseded_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ProjectBacklogFile {
  next_id_seq: number;
  items: ProjectItem[];
}

// ── Spec schema (markdown, structurally validated) ─────────────────────────
// The six fixed H2 sections every project's spec.md must carry.
// Order is the canonical reading order; validateSpec checks presence, not order.
export const REQUIRED_SPEC_SECTIONS = [
  "Goal",
  "Scope IN",
  "Scope OUT",
  "Success Criteria",
  "Open Questions",
  "Constraints",
] as const;

export type SpecSectionName = (typeof REQUIRED_SPEC_SECTIONS)[number];

export function validateSpec(specMd: string): { ok: true } | { ok: false; missing: SpecSectionName[] } {
  const headings = new Set(
    [...specMd.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim()),
  );
  const missing = REQUIRED_SPEC_SECTIONS.filter((s) => !headings.has(s));
  return missing.length ? { ok: false, missing } : { ok: true };
}

// ── I/O ─────────────────────────────────────────────────────────────────────
const writeJson = (path: string, data: unknown): void => {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

export function readFeatures(repoRoot: string): ProjectFeaturesFile {
  return JSON.parse(readFileSync(join(lanesDir(repoRoot), "features.json"), "utf8"));
}
export function writeFeatures(repoRoot: string, data: ProjectFeaturesFile): void {
  writeJson(join(lanesDir(repoRoot), "features.json"), data);
}

export function readBacklog(repoRoot: string): ProjectBacklogFile {
  return JSON.parse(readFileSync(join(lanesDir(repoRoot), "backlog.json"), "utf8"));
}
export function writeBacklog(repoRoot: string, data: ProjectBacklogFile): void {
  writeJson(join(lanesDir(repoRoot), "backlog.json"), data);
}

export function readSummary(repoRoot: string): string {
  return readFileSync(join(lanesDir(repoRoot), "summary.md"), "utf8");
}
export function readSpec(repoRoot: string): string {
  return readFileSync(join(lanesDir(repoRoot), "spec.md"), "utf8");
}
export function readPlan(repoRoot: string): string {
  return readFileSync(join(lanesDir(repoRoot), "plan.md"), "utf8");
}
