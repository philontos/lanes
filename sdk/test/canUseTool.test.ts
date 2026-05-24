import { describe, it, expect, vi } from "vitest";
import { makeCanUseTool } from "../src/canUseTool.js";

const opts = { signal: new AbortController().signal, toolUseID: "t1" } as any;

describe("makeCanUseTool", () => {
  it("routes AskUserQuestion to the judge and returns answers", async () => {
    const fakeJudge = vi.fn(async () => ({ "Q?": "A" }));
    const cb = makeCanUseTool("principles", { judgeFn: fakeJudge as any });
    const res = await cb("AskUserQuestion", { questions: [{ question: "Q?", header: "q", options: [{ label: "A", description: "" }], multiSelect: false }] }, opts);
    expect(res.behavior).toBe("allow");
    expect((res as any).updatedInput.answers).toEqual({ "Q?": "A" });
    expect(fakeJudge).toHaveBeenCalledOnce();
  });
  it("allows safe tools unchanged", async () => {
    const cb = makeCanUseTool("p", { judgeFn: vi.fn() as any });
    const res = await cb("Read", { file_path: "/x" }, opts);
    expect(res.behavior).toBe("allow");
  });
  it("denies Bash in MVP (host safety before Docker)", async () => {
    const cb = makeCanUseTool("p", { judgeFn: vi.fn() as any });
    const res = await cb("Bash", { command: "rm -rf /" }, opts);
    expect(res.behavior).toBe("deny");
  });
});
