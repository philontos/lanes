import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLane } from "../src/orchestrator.js";

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
});
