import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPulse } from "../src/pulse.js";

// Builds a fresh git repo with a configurable .lanes/* state. Used to exercise
// buildPulse end-to-end without depending on a real lanes-workspace.
function makeRepo(opts: {
  features?: any[];
  items?: any[];
  cycles?: { id: string; state?: any; reflection?: string }[];
  branches?: string[];              // extra lanes/* branches to leave unmerged
} = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "lanes-pulse-"));
  spawnSync("git", ["-C", dir, "init", "-q", "-b", "main"], { stdio: "ignore" });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t.com"], { stdio: "ignore" });
  spawnSync("git", ["-C", dir, "config", "user.name", "T"], { stdio: "ignore" });
  spawnSync("git", ["-C", dir, "config", "commit.gpgsign", "false"], { stdio: "ignore" });

  // .lane/ is per-cycle scratch (not project state) — PROTOCOL says gitignore it.
  // Without this, the per-cycle dirs become tracked on whichever branch is checked
  // out when they were created, and disappear on `git checkout`.
  writeFileSync(join(dir, ".gitignore"), ".lane/\n");

  mkdirSync(join(dir, ".lanes"));
  writeFileSync(join(dir, ".lanes/features.json"), JSON.stringify({
    next_id_seq: (opts.features?.length ?? 0) + 1,
    features: opts.features ?? [],
  }));
  writeFileSync(join(dir, ".lanes/backlog.json"), JSON.stringify({
    next_id_seq: (opts.items?.length ?? 0) + 1,
    items: opts.items ?? [],
  }));
  writeFileSync(join(dir, ".lanes/spec.md"), "## Goal\n## Scope IN\n## Scope OUT\n## Success Criteria\n## Open Questions\n## Constraints\n");
  writeFileSync(join(dir, ".lanes/plan.md"), "# plan\n");
  writeFileSync(join(dir, ".lanes/summary.md"), "# repo\n\nA repo.\n");

  spawnSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
  spawnSync("git", ["-C", dir, "commit", "-q", "-m", "reshape: initial state"], { stdio: "ignore" });

  if (opts.cycles?.length) {
    for (const c of opts.cycles) {
      const cdir = join(dir, ".lane", "cycles", c.id);
      mkdirSync(cdir, { recursive: true });
      if (c.state) writeFileSync(join(cdir, "state.json"), JSON.stringify(c.state));
      if (c.reflection !== undefined) writeFileSync(join(cdir, "reflection.md"), c.reflection);
    }
  }

  if (opts.branches?.length) {
    for (const b of opts.branches) {
      spawnSync("git", ["-C", dir, "branch", b], { stdio: "ignore" });
    }
  }

  return dir;
}

describe("buildPulse", () => {
  it("reports last activity on main", () => {
    const dir = makeRepo();
    const p = buildPulse("probe", dir);
    expect(p.last_activity?.subject).toBe("reshape: initial state");
    expect(p.last_activity?.commit).toMatch(/^[0-9a-f]{7}$/);
  });

  it("returns empty next_up when backlog is empty", () => {
    const dir = makeRepo();
    expect(buildPulse("probe", dir).next_up).toEqual([]);
  });

  it("returns up to 3 todo/blocked items in next_up, with feature title", () => {
    const features = [
      { id: "feature-0001", title: "Auth", why: "", design_notes: "", lifecycle: "active", superseded_by: null, created_at: "" },
    ];
    const items = [
      { id: "item-0001", title: "A", feature_id: "feature-0001", acceptance: [], status: "todo", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: null },
      { id: "item-0002", title: "B", feature_id: "feature-0001", acceptance: [], status: "blocked", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: null },
      { id: "item-0003", title: "C", feature_id: "feature-0001", acceptance: [], status: "done", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: "x" },
      { id: "item-0004", title: "D", feature_id: "feature-0001", acceptance: [], status: "todo", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: null },
      { id: "item-0005", title: "E", feature_id: "feature-0001", acceptance: [], status: "todo", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: null },
    ];
    const dir = makeRepo({ features, items });
    const nx = buildPulse("probe", dir).next_up;
    expect(nx.map((n) => n.item_id)).toEqual(["item-0001", "item-0002", "item-0004"]);
    expect(nx[0].feature_title).toBe("Auth");
  });

  it("finds reflection.md summaries newest-first", () => {
    const dir = makeRepo({
      cycles: [
        { id: "cycle-20260528-100000", reflection: "# Reflection\n\nFirst para of older.\n\nIgnored.\n" },
        { id: "cycle-20260528-120000", reflection: "# Reflection\n\nFirst para of newer.\n" },
      ],
    });
    const refs = buildPulse("probe", dir).recent_reflections;
    expect(refs[0]).toEqual({ cycle_id: "cycle-20260528-120000", summary: "First para of newer." });
    expect(refs[1]).toEqual({ cycle_id: "cycle-20260528-100000", summary: "First para of older." });
  });

  it("skips cycles without reflection.md", () => {
    const dir = makeRepo({
      cycles: [
        { id: "cycle-A" },              // no reflection
        { id: "cycle-B", reflection: "body" },
      ],
    });
    const refs = buildPulse("probe", dir).recent_reflections;
    expect(refs.map((r) => r.cycle_id)).toEqual(["cycle-B"]);
  });

  it("flags unmerged lanes/* branches as pending_review", () => {
    const dir = makeRepo({
      cycles: [{ id: "cycle-pending", reflection: "ref body" }],
    });
    // A branch counts as "pending" only when it has commits not on main —
    // creating a same-tip branch is "merged" from git's POV. Add a divergent commit.
    spawnSync("git", ["-C", dir, "checkout", "-q", "-b", "lanes/cycle-pending"], { stdio: "ignore" });
    writeFileSync(join(dir, ".lanes/plan.md"), "# plan v2\n");
    spawnSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
    spawnSync("git", ["-C", dir, "commit", "-q", "-m", "shape: revise plan"], { stdio: "ignore" });
    spawnSync("git", ["-C", dir, "checkout", "-q", "main"], { stdio: "ignore" });

    const pr = buildPulse("probe", dir).pending_review;
    expect(pr).toHaveLength(1);
    expect(pr[0].branch).toBe("lanes/cycle-pending");
    expect(pr[0].cycle_id).toBe("cycle-pending");
    expect(pr[0].has_reflection).toBe(true);
    expect(pr[0].commit_subject).toBe("shape: revise plan");
  });

  it("excludes merged lanes/* branches from pending_review", () => {
    const dir = makeRepo({});
    // create + checkout + commit + merge
    spawnSync("git", ["-C", dir, "checkout", "-q", "-b", "lanes/done"], { stdio: "ignore" });
    writeFileSync(join(dir, ".lanes/plan.md"), "# plan v2\n");
    spawnSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
    spawnSync("git", ["-C", dir, "commit", "-q", "-m", "second"], { stdio: "ignore" });
    spawnSync("git", ["-C", dir, "checkout", "-q", "main"], { stdio: "ignore" });
    spawnSync("git", ["-C", dir, "merge", "-q", "--no-ff", "lanes/done", "-m", "merge"], { stdio: "ignore" });
    expect(buildPulse("probe", dir).pending_review).toEqual([]);
  });

  it("includes the drift report", () => {
    const features = [
      { id: "feature-0001", title: "X", why: "", design_notes: "", lifecycle: "active", superseded_by: null, created_at: "" },
    ];
    const items = [
      { id: "item-0001", title: "A", feature_id: "feature-9999", acceptance: [], status: "todo", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: null },
    ];
    const dir = makeRepo({ features, items });
    const d = buildPulse("probe", dir).drift;
    expect(d.total).toBeGreaterThanOrEqual(1);
    expect(d.item_feature_missing[0].item_id).toBe("item-0001");
  });
});
