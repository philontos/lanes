import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, writeState } from "../src/state.js";

describe("state", () => {
  it("reads state.json from a cycle dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-"));
    writeFileSync(join(dir, "state.json"), JSON.stringify({ phase: "spec", status: "ok", autonomy: "auto" }));
    expect(readState(dir).phase).toBe("spec");
  });
  it("writes state.json as valid whole-file JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-"));
    writeState(dir, { phase: "spec", status: "ok", autonomy: "auto" } as any);
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).status).toBe("ok");
  });
});
