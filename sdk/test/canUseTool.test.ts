import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCanUseTool } from "../src/canUseTool.js";

const opts = { signal: new AbortController().signal, toolUseID: "t1" } as any;
const askQ = { questions: [{ question: "Q?", header: "q", options: [{ label: "A", description: "" }], multiSelect: false }] };

describe("makeCanUseTool (container = boundary; tools open)", () => {
  it("routes AskUserQuestion to the judge and returns answers", async () => {
    const fakeJudge = vi.fn(async () => ({ answers: { "Q?": "A" }, degraded: false }));
    const cb = makeCanUseTool("principles", { judgeFn: fakeJudge as any });
    const res = await cb("AskUserQuestion", askQ, opts);
    expect(res.behavior).toBe("allow");
    expect((res as any).updatedInput.answers).toEqual({ "Q?": "A" });
    expect(fakeJudge).toHaveBeenCalledOnce();
  });
  it("flags the decision log with ⚠ when the judge degraded to fallback", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "cut-")), "decision-log.md");
    const degraded = vi.fn(async () => ({ answers: { "Q?": "A" }, degraded: true }));
    const cb = makeCanUseTool("p", { judgeFn: degraded as any, logPath });
    await cb("AskUserQuestion", askQ, opts);
    expect(readFileSync(logPath, "utf8")).toContain("⚠");
  });
  it("allows file tools unchanged", async () => {
    const cb = makeCanUseTool("p", { judgeFn: vi.fn() as any });
    expect((await cb("Read", { file_path: "/x" }, opts)).behavior).toBe("allow");
  });
  it("allows Bash now (Docker is the isolation boundary)", async () => {
    const cb = makeCanUseTool("p", { judgeFn: vi.fn() as any });
    expect((await cb("Bash", { command: "npm test" }, opts)).behavior).toBe("allow");
  });
});
