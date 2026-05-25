import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLane } from "../src/orchestrator.js";

function tmpLane() {
  const wt = join(mkdtempSync(join(tmpdir(), "lane-")), "cycle");
  mkdirSync(join(wt, ".lane"), { recursive: true });
  writeFileSync(join(wt, ".lane", "state.json"), JSON.stringify({ lane: "forge", cycle_id: "c1", phase: "spec", status: "ok", autonomy: "auto", request: "do x" }));
  return wt;
}
const baseOpts = (wt: string) => ({ worktreeDir: wt, commandsDir: "/unused", lane: "forge", principlesPath: "/unused" });

describe("runLane", () => {
  it("runs phases in order and marks done on success", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: "success" }; });
    await runLane(baseOpts(wt), { runPhase: stub as any });
    expect(seen).toEqual(["spec", "plan", "impl", "review"]);
    expect(JSON.parse(readFileSync(join(wt, ".lane", "state.json"), "utf8")).status).toBe("done");
  });
  it("stops at the first failing phase and marks blocked", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: o.phase === "impl" ? "error" : "success" }; });
    const res = await runLane(baseOpts(wt), { runPhase: stub as any });
    expect(seen).toEqual(["spec", "plan", "impl"]);
    expect((res as any).subtype).toBe("error");
    const st = JSON.parse(readFileSync(join(wt, ".lane", "state.json"), "utf8"));
    expect(st.phase).toBe("impl");
    expect(st.status).toBe("blocked");
  });
  it("accrues an append-only history and clears next when done", async () => {
    const wt = tmpLane();
    const stub = vi.fn(async () => ({ subtype: "success" }));
    await runLane(baseOpts(wt), { runPhase: stub as any });
    const st = JSON.parse(readFileSync(join(wt, ".lane", "state.json"), "utf8"));
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
    const st = JSON.parse(readFileSync(join(wt, ".lane", "state.json"), "utf8"));
    expect(st.history.map((h: any) => [h.phase, h.status])).toEqual([["spec", "ok"], ["plan", "blocked"]]);
  });
});
