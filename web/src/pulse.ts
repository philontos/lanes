// Project Pulse — the "scan in 5 seconds" surface for a project. Aggregates:
//   - last activity on main
//   - in-flight cycles (live + pending unmerged branches)
//   - next-up backlog items
//   - recent reflection.md summaries (the closed-loop output from cycles)
//   - static drift report
//
// This is read-only. Computes on every request — no cache. Designed to be cheap:
// a few git invocations + filesystem reads of small json/md files.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBacklog, readFeatures } from "../../sdk/src/project/state.js";
import { listLiveCycles } from "./cycles.js";
import { checkDrift, type DriftReport } from "./drift.js";

export interface PulseLastActivity {
  when_iso: string;
  relative: string;        // "3 hours ago"
  subject: string;         // commit subject
  commit: string;          // short hash
}

export interface PulseInFlight {
  cycle_id: string;
  lane: string;            // "forge" | "init" | "reshape"
  phase: string;
  request_excerpt: string; // first ~100 chars of the cycle's request
  ended: boolean;
  exit_code: number | null;
}

export interface PulsePendingReview {
  branch: string;                // "lanes/<cycle-id>"
  cycle_id: string;
  commit_subject: string;
  has_reflection: boolean;       // reflection.md present in cycle dir?
}

export interface PulseNextUp {
  item_id: string;
  title: string;
  feature_id: string;
  feature_title: string | null;
  status: string;
}

export interface PulseReflection {
  cycle_id: string;
  summary: string;               // first heading-less paragraph of reflection.md
}

export interface PulseData {
  last_activity: PulseLastActivity | null;
  in_flight: PulseInFlight[];
  pending_review: PulsePendingReview[];
  next_up: PulseNextUp[];
  recent_reflections: PulseReflection[];
  drift: DriftReport;
}

const RECENT_REFLECTIONS = 5;
const NEXT_UP_LIMIT = 3;

export function buildPulse(projectName: string, projectPath: string): PulseData {
  return {
    last_activity: lastActivityOnMain(projectPath),
    in_flight: liveForProject(projectName),
    pending_review: pendingReviewBranches(projectPath),
    next_up: nextUpItems(projectPath),
    recent_reflections: recentReflections(projectPath),
    drift: driftReport(projectPath),
  };
}

// ── Last activity on main ─────────────────────────────────────────────────
// Most recent commit on main that touched any .lanes/* file. Gives the user a
// "when was this project last meaningfully changed?" anchor.
function lastActivityOnMain(projectPath: string): PulseLastActivity | null {
  const r = spawnSync(
    "git", ["-C", projectPath, "log", "-1", "--format=%H|%cr|%s", "main", "--", ".lanes/"],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout.trim()) return null;
  const [commit, relative, ...subjectParts] = r.stdout.trim().split("|");
  const subject = subjectParts.join("|");
  // When too — for sorting / inspection
  const whenR = spawnSync(
    "git", ["-C", projectPath, "log", "-1", "--format=%cI", commit],
    { encoding: "utf8" },
  );
  return {
    when_iso: whenR.stdout.trim(),
    relative,
    subject,
    commit: commit.slice(0, 7),
  };
}

// ── In-flight cycles for this project ─────────────────────────────────────
function liveForProject(projectName: string): PulseInFlight[] {
  // listLiveCycles returns only the bare {cycle_id, project, ended, exit_code};
  // we don't currently carry lane/phase/request on the in-memory entry, so we
  // backfill from the cycle's state.json on disk. Fast — file is tiny.
  const live = listLiveCycles().filter((c) => c.project === projectName);
  return live.map((c) => {
    const stateFile = (process.env.LANES_WORKSPACE
      ? join(process.env.LANES_WORKSPACE, projectName, ".lane", "cycles", c.cycle_id, "state.json")
      : "");
    let lane = "?", phase = "?", request_excerpt = "";
    try {
      if (stateFile && existsSync(stateFile)) {
        const s = JSON.parse(readFileSync(stateFile, "utf8"));
        lane = String(s.lane ?? "?");
        phase = String(s.phase ?? "?");
        request_excerpt = String(s.request ?? "").slice(0, 100);
      }
    } catch { /* ignore */ }
    return { cycle_id: c.cycle_id, lane, phase, request_excerpt, ended: c.ended, exit_code: c.exit_code };
  });
}

// ── Pending review branches ───────────────────────────────────────────────
// Local `lanes/*` branches that are not merged into main. These are proposals
// waiting on the user's eyeball + git merge.
function pendingReviewBranches(projectPath: string): PulsePendingReview[] {
  // git for-each-ref instead of `branch --no-merged` for cleaner output and to
  // get the subject of the branch tip in one shot.
  const r = spawnSync(
    "git", ["-C", projectPath, "for-each-ref",
            "--format=%(refname:short)|%(contents:subject)",
            "refs/heads/lanes/"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return [];

  // Get the set of branches already merged into main, to exclude
  const mergedR = spawnSync(
    "git", ["-C", projectPath, "branch", "--list", "lanes/*", "--merged", "main", "--format=%(refname:short)"],
    { encoding: "utf8" },
  );
  const merged = new Set((mergedR.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean));

  const out: PulsePendingReview[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [branch, ...subjectParts] = line.split("|");
    if (merged.has(branch)) continue;
    const cycle_id = branch.replace(/^lanes\//, "");
    const refl = join(projectPath, ".lane", "cycles", cycle_id, "reflection.md");
    out.push({
      branch,
      cycle_id,
      commit_subject: subjectParts.join("|").trim(),
      has_reflection: existsSync(refl),
    });
  }
  // Newest first by cycle id (date-sortable format)
  out.sort((a, b) => (a.cycle_id < b.cycle_id ? 1 : -1));
  return out;
}

// ── Next up backlog items ─────────────────────────────────────────────────
function nextUpItems(projectPath: string): PulseNextUp[] {
  try {
    const backlog = readBacklog(projectPath);
    const features = readFeatures(projectPath);
    const featureTitleById = new Map(features.features.map((f) => [f.id, f.title] as const));
    return backlog.items
      .filter((i) => i.status === "todo" || i.status === "blocked")
      .slice(0, NEXT_UP_LIMIT)
      .map((i) => ({
        item_id: i.id, title: i.title, feature_id: i.feature_id,
        feature_title: featureTitleById.get(i.feature_id) ?? null,
        status: i.status,
      }));
  } catch { return []; }
}

// ── Recent reflections ─────────────────────────────────────────────────────
// Scan .lane/cycles/*/reflection.md, newest first by cycle id.
function recentReflections(projectPath: string): PulseReflection[] {
  const cyclesDir = join(projectPath, ".lane", "cycles");
  if (!existsSync(cyclesDir)) return [];
  const ids = readdirSync(cyclesDir).sort().reverse();
  const out: PulseReflection[] = [];
  for (const cycle_id of ids) {
    if (out.length >= RECENT_REFLECTIONS) break;
    const f = join(cyclesDir, cycle_id, "reflection.md");
    if (!existsSync(f)) continue;
    try {
      const md = readFileSync(f, "utf8");
      out.push({ cycle_id, summary: firstParagraph(md) });
    } catch { /* skip */ }
  }
  return out;
}

// Extract the first non-empty, non-heading paragraph from a markdown doc.
function firstParagraph(md: string): string {
  for (const block of md.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;       // skip headings
    return t.length > 240 ? t.slice(0, 237) + "…" : t;
  }
  return "(no body)";
}

// ── Drift ─────────────────────────────────────────────────────────────────
function driftReport(projectPath: string): DriftReport {
  try {
    const features = readFeatures(projectPath);
    const backlog = readBacklog(projectPath);
    return checkDrift(features.features, backlog.items);
  } catch {
    // Project state files missing — count as zero drift (project just not
    // initialised yet).
    return {
      item_feature_missing: [],
      item_feature_dropped: [],
      feature_superseded_dangling: [],
      feature_unused: [],
      total: 0,
    };
  }
}
