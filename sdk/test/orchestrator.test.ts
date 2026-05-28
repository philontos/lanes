import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLane, deriveCycleOutcome } from "../src/orchestrator.js";

// Bootstrap lays out a born-isolated cycle: .lane/current-cycle points at the cycle
// id, and that cycle's state lives under .lane/cycles/<id>/. The orchestrator must
// resolve the active lane dir from the pointer.
function tmpLane(cycleId = "c1") {
  const wt = join(mkdtempSync(join(tmpdir(), "lane-")), "cycle");
  mkdirSync(join(wt, ".lane", "cycles", cycleId), { recursive: true });
  writeFileSync(join(wt, ".lane", "current-cycle"), cycleId + "\n");
  writeFileSync(join(wt, ".lane", "cycles", cycleId, "state.json"), JSON.stringify({ lane: "forge", cycle_id: cycleId, phase: "spec", status: "ok", autonomy: "auto", request: "do x" }));
  return wt;
}
function readBack(wt: string) {
  const id = readFileSync(join(wt, ".lane", "current-cycle"), "utf8").trim();
  return JSON.parse(readFileSync(join(wt, ".lane", "cycles", id, "state.json"), "utf8"));
}
const baseOpts = (wt: string) => ({ worktreeDir: wt, configPath: "/unused", principlesPath: "/unused" });

describe("runLane", () => {
  it("runs phases in order and marks done on success", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: "success" }; });
    await runLane(baseOpts(wt), { runPhase: stub as any });
    expect(seen).toEqual(["spec", "plan", "impl", "review"]);
    expect(readBack(wt).status).toBe("done");
  });
  it("stops at the first failing phase and marks blocked", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: o.phase === "impl" ? "error" : "success" }; });
    const res = await runLane(baseOpts(wt), { runPhase: stub as any });
    expect(seen).toEqual(["spec", "plan", "impl"]);
    expect((res as any).subtype).toBe("error");
    const st = readBack(wt);
    expect(st.phase).toBe("impl");
    expect(st.status).toBe("blocked");
  });
  it("accrues an append-only history and clears next when done", async () => {
    const wt = tmpLane();
    const stub = vi.fn(async () => ({ subtype: "success" }));
    await runLane(baseOpts(wt), { runPhase: stub as any });
    const st = readBack(wt);
    expect(st.history.map((h: any) => h.phase)).toEqual(["spec", "plan", "impl", "review"]);
    expect(st.history.every((h: any) => h.status === "ok" && typeof h.at === "string")).toBe(true);
    expect(st.next).toBe(null);
  });
  it("resumes from startPhase", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: "success" }; });
    await runLane({ ...baseOpts(wt), startPhase: "impl" }, { runPhase: stub as any });
    expect(seen).toEqual(["impl", "review"]);
  });
  it("records the failing phase in history as blocked", async () => {
    const wt = tmpLane();
    const stub = vi.fn(async (o: any) => ({ subtype: o.phase === "plan" ? "error" : "success" }));
    await runLane(baseOpts(wt), { runPhase: stub as any });
    const st = readBack(wt);
    expect(st.history.map((h: any) => [h.phase, h.status])).toEqual([["spec", "ok"], ["plan", "blocked"]]);
  });
  it("marks the phase blocked + records history when a phase THROWS, then rethrows", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => {
      seen.push(o.phase);
      if (o.phase === "plan") throw new Error("model 5xx");
      return { subtype: "success" };
    });
    await expect(runLane(baseOpts(wt), { runPhase: stub as any })).rejects.toThrow("model 5xx");
    expect(seen).toEqual(["spec", "plan"]); // chain stops at the throw
    const st = readBack(wt);
    expect(st.phase).toBe("plan");
    expect(st.status).toBe("blocked"); // not the "ok" written before the phase ran
    expect(st.history.map((h: any) => [h.phase, h.status])).toEqual([["spec", "ok"], ["plan", "blocked"]]);
  });
  it("re-runs impl with the review feedback on reject, then completes when review passes", async () => {
    const wt = tmpLane();
    const seen: { phase: string; feedback?: string[] }[] = [];
    const run = vi.fn(async (o: any) => { seen.push({ phase: o.phase, feedback: o.reviewFeedback }); return { subtype: "success" }; });
    const verdicts = [{ verdict: "reject", reasons: ["weakened a test"] }, { verdict: "pass", reasons: [] }];
    const readVerdict = vi.fn(() => verdicts.shift() ?? { verdict: "pass", reasons: [] });
    await runLane(baseOpts(wt), { runPhase: run as any, readVerdict: readVerdict as any });
    expect(seen.map((s) => s.phase)).toEqual(["spec", "plan", "impl", "review", "impl", "review"]);
    expect(seen[2].feedback).toBeUndefined();              // first impl: no feedback
    expect(seen[4]).toEqual({ phase: "impl", feedback: ["weakened a test"] }); // retry impl gets the reasons
    expect(readBack(wt).status).toBe("done");
  });
  it("blocks after exhausting review retries when the verdict keeps rejecting", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const run = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: "success" }; });
    const readVerdict = vi.fn(() => ({ verdict: "reject", reasons: ["hack to green"] }));
    await runLane(baseOpts(wt), { runPhase: run as any, readVerdict: readVerdict as any });
    expect(seen.filter((p) => p === "impl").length).toBe(3);   // initial + 2 retries
    expect(seen.filter((p) => p === "review").length).toBe(3);
    const st = readBack(wt);
    expect(st.status).toBe("blocked");
    expect(st.phase).toBe("review");
    expect(st.gate?.reasons).toEqual(["hack to green"]);
  });
  it("fails loud when the .lane/current-cycle pointer is missing", async () => {
    const wt = join(mkdtempSync(join(tmpdir(), "lane-")), "cycle");
    mkdirSync(join(wt, ".lane"), { recursive: true });
    const stub = vi.fn(async () => ({ subtype: "success" }));
    await expect(runLane(baseOpts(wt), { runPhase: stub as any })).rejects.toThrow(/current-cycle/);
    expect(stub).not.toHaveBeenCalled();
  });

  // ── Project-state integration (when state.item_id is set) ──────────────────
  // tmpLaneWithItem builds a worktree that has BOTH .lane/ (cycle scratch) and
  // .lanes/ (project state with the item the cycle is bound to). The web/CLI
  // entry would write item_id into state.json when triggering from a backlog
  // item; here we simulate that.
  function tmpLaneWithItem(cycleId = "c-item", itemId = "item-0001") {
    const wt = tmpLane(cycleId);
    // Seed .lanes/ with the item we'll bind the cycle to.
    mkdirSync(join(wt, ".lanes"));
    writeFileSync(join(wt, ".lanes", "backlog.json"), JSON.stringify({
      next_id_seq: 2,
      items: [{
        id: itemId, title: "Some item", feature_id: "feature-0001",
        acceptance: [], status: "todo", cycles: [], notes: "",
        superseded_by: null, created_at: "", completed_at: null,
      }],
    }, null, 2));
    // Inject item_id into the cycle's state.json so the orchestrator picks it up.
    const stateFile = join(wt, ".lane", "cycles", cycleId, "state.json");
    const st = JSON.parse(readFileSync(stateFile, "utf8"));
    st.item_id = itemId;
    writeFileSync(stateFile, JSON.stringify(st));
    return wt;
  }
  function readBacklog(wt: string) {
    return JSON.parse(readFileSync(join(wt, ".lanes", "backlog.json"), "utf8"));
  }

  it("marks the bound item in-progress at start and done on full success", async () => {
    const wt = tmpLaneWithItem();
    const stub = vi.fn(async () => ({ subtype: "success" }));
    await runLane(baseOpts(wt), { runPhase: stub as any });
    const b = readBacklog(wt);
    expect(b.items[0].status).toBe("done");
    expect(b.items[0].cycles).toHaveLength(1);
    expect(b.items[0].cycles[0]).toMatchObject({ cycle_id: "c-item", verdict: "pass" });
    expect(b.items[0].completed_at).not.toBeNull();
    expect(existsSync(join(wt, ".lane", "cycles", "c-item", "integration-notes.md"))).toBe(true);
  });

  it("marks the bound item blocked when a phase fails", async () => {
    const wt = tmpLaneWithItem();
    const stub = vi.fn(async (o: any) => ({ subtype: o.phase === "impl" ? "error" : "success" }));
    await runLane(baseOpts(wt), { runPhase: stub as any });
    const b = readBacklog(wt);
    expect(b.items[0].status).toBe("blocked");
    expect(b.items[0].completed_at).toBeNull();
  });

  it("still runs integration when a phase throws, and re-throws the original error", async () => {
    const wt = tmpLaneWithItem();
    const stub = vi.fn(async () => { throw new Error("network died"); });
    await expect(runLane(baseOpts(wt), { runPhase: stub as any })).rejects.toThrow(/network died/);
    const b = readBacklog(wt);
    expect(b.items[0].status).toBe("blocked");
    expect(existsSync(join(wt, ".lane", "cycles", "c-item", "integration-notes.md"))).toBe(true);
  });

  it("skips project-state hooks entirely when state has no item_id (legacy free-text run)", async () => {
    const wt = tmpLane();  // no .lanes/, no item_id in state
    const stub = vi.fn(async () => ({ subtype: "success" }));
    await runLane(baseOpts(wt), { runPhase: stub as any });
    // .lanes dir should not exist; integration was skipped.
    expect(existsSync(join(wt, ".lanes"))).toBe(false);
  });
});

describe("deriveCycleOutcome", () => {
  it("success when chain finished with status=done", () => {
    expect(deriveCycleOutcome({ cycle_id: "X", status: "done" }, null))
      .toEqual({ cycle_id: "X", status: "success", verdict: "pass" });
  });
  it("blocked + reject when review gate exhausted", () => {
    expect(deriveCycleOutcome(
      { cycle_id: "X", status: "blocked", gate: { verdict: "reject", reasons: ["a", "b"] } },
      null,
    )).toEqual({ cycle_id: "X", status: "blocked", verdict: "reject", reason: "a; b" });
  });
  it("blocked when chain threw, with the error message as reason", () => {
    const o = deriveCycleOutcome({ cycle_id: "X", status: "ok" }, new Error("boom"));
    expect(o.status).toBe("blocked");
    expect(o.reason).toBe("boom");
  });
  it("blocked when chain ended non-done without a gate (e.g. phase returned error)", () => {
    expect(deriveCycleOutcome({ cycle_id: "X", status: "blocked" }, null))
      .toEqual({ cycle_id: "X", status: "blocked", reason: "chain ended with status=blocked" });
  });
});
