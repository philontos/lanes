import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProject, summariseCycle, cycleDirSafe } from "../src/project.js";

function makeProject(opts: {
  features?: any[]; items?: any[]; cycles?: { id: string; state?: any; hasRunLog?: boolean }[];
  summary?: string; spec?: string; plan?: string;
  lanesDir?: boolean;
} = {}): string {
  const p = mkdtempSync(join(tmpdir(), "lanes-proj-"));
  mkdirSync(join(p, ".git"));
  if (opts.lanesDir !== false) {
    mkdirSync(join(p, ".lanes"));
    writeFileSync(join(p, ".lanes/summary.md"), opts.summary ?? "# Test\n\nA test project.\n");
    writeFileSync(join(p, ".lanes/spec.md"), opts.spec ?? "## Goal\n(none yet)\n");
    writeFileSync(join(p, ".lanes/plan.md"), opts.plan ?? "# Tech Plan\n");
    writeFileSync(join(p, ".lanes/features.json"), JSON.stringify({
      next_id_seq: (opts.features?.length ?? 0) + 1,
      features: opts.features ?? [],
    }));
    writeFileSync(join(p, ".lanes/backlog.json"), JSON.stringify({
      next_id_seq: (opts.items?.length ?? 0) + 1,
      items: opts.items ?? [],
    }));
  }
  if (opts.cycles?.length) {
    for (const c of opts.cycles) {
      const dir = join(p, ".lane", "cycles", c.id);
      mkdirSync(dir, { recursive: true });
      if (c.state) writeFileSync(join(dir, "state.json"), JSON.stringify(c.state));
      if (c.hasRunLog) writeFileSync(join(dir, "run.log"), "log content");
    }
  }
  return p;
}

describe("readProject", () => {
  it("returns null when .lanes/ is missing", () => {
    const p = makeProject({ lanesDir: false });
    expect(readProject(p, "x")).toBeNull();
  });

  it("returns the full view for an initialised empty project", () => {
    const p = makeProject();
    const v = readProject(p, "alpha")!;
    expect(v.name).toBe("alpha");
    expect(v.display_status).toBe("todo");
    expect(v.summary_md).toContain("A test project.");
    expect(v.features).toEqual([]);
    expect(v.items).toEqual([]);
    expect(v.recent_cycles).toEqual([]);
  });

  it("computes feature.display_status from items", () => {
    const p = makeProject({
      features: [{ id: "feature-0001", title: "F", why: "", design_notes: "", lifecycle: "active", superseded_by: null, created_at: "" }],
      items: [
        { id: "item-0001", title: "A", feature_id: "feature-0001", acceptance: [], status: "done", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: null },
        { id: "item-0002", title: "B", feature_id: "feature-0001", acceptance: [], status: "in-progress", cycles: [], notes: "", superseded_by: null, created_at: "", completed_at: null },
      ],
    });
    const v = readProject(p, "x")!;
    expect(v.features[0].display_status).toBe("in-progress");
    expect(v.display_status).toBe("in-progress");
  });

  it("lists recent cycles with state metadata", () => {
    const p = makeProject({
      cycles: [
        { id: "cycle-20260528-120000", state: { status: "done", phase: "review", request: "do x" }, hasRunLog: true },
        { id: "cycle-20260528-100000", state: { status: "blocked", phase: "impl", request: "do y" } },
      ],
    });
    const v = readProject(p, "x")!;
    // Newest first
    expect(v.recent_cycles[0].cycle_id).toBe("cycle-20260528-120000");
    expect(v.recent_cycles[0].state_status).toBe("done");
    expect(v.recent_cycles[0].state_phase).toBe("review");
    expect(v.recent_cycles[0].has_run_log).toBe(true);
    expect(v.recent_cycles[1].state_status).toBe("blocked");
    expect(v.recent_cycles[1].has_run_log).toBe(false);
  });
});

describe("summariseCycle", () => {
  it("returns has_state:false when no state.json", () => {
    const p = makeProject({ cycles: [{ id: "cycle-x" }] });
    expect(summariseCycle(p, "cycle-x")).toEqual({
      cycle_id: "cycle-x", has_state: false, has_run_log: false,
    });
  });
  it("reads state.status / state.phase / state.request from state.json", () => {
    const p = makeProject({ cycles: [{ id: "cycle-y", state: { status: "done", phase: "review", request: "r" } }] });
    expect(summariseCycle(p, "cycle-y")).toMatchObject({
      cycle_id: "cycle-y", has_state: true,
      state_status: "done", state_phase: "review", state_request: "r",
    });
  });
});

describe("cycleDirSafe", () => {
  it("returns the dir for a valid cycle id", () => {
    const p = makeProject({ cycles: [{ id: "cycle-good-1" }] });
    expect(cycleDirSafe(p, "cycle-good-1")).toBe(join(p, ".lane", "cycles", "cycle-good-1"));
  });
  it("rejects directory traversal attempts", () => {
    const p = makeProject({});
    expect(() => cycleDirSafe(p, "../../etc")).toThrow(/invalid cycle id/);
    expect(() => cycleDirSafe(p, "cycle-../bad")).toThrow(/invalid cycle id/);
  });
  it("rejects ids not matching cycle-* shape", () => {
    const p = makeProject({});
    expect(() => cycleDirSafe(p, "no-cycle-prefix")).toThrow(/invalid cycle id/);
  });
  it("throws when the cycle dir doesn't exist", () => {
    const p = makeProject({});
    expect(() => cycleDirSafe(p, "cycle-missing")).toThrow(/not found/);
  });
});
