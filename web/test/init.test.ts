import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initProject } from "../src/init.js";
import { REQUIRED_SPEC_SECTIONS, validateSpec } from "../../sdk/src/project/state.js";

function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), "lanes-init-"));
}

describe("initProject", () => {
  it("creates the five .lanes/* files", () => {
    const dir = emptyDir();
    initProject(dir);
    for (const f of ["summary.md", "spec.md", "features.json", "plan.md", "backlog.json"]) {
      expect(existsSync(join(dir, ".lanes", f))).toBe(true);
    }
  });

  it("the produced spec.md passes validateSpec (all six H2 sections present)", () => {
    const dir = emptyDir();
    initProject(dir);
    const md = readFileSync(join(dir, ".lanes/spec.md"), "utf8");
    expect(validateSpec(md)).toEqual({ ok: true });
    // sanity: literal section headings
    for (const s of REQUIRED_SPEC_SECTIONS) {
      expect(md).toContain(`## ${s}`);
    }
  });

  it("features.json and backlog.json parse as the empty-start shape", () => {
    const dir = emptyDir();
    initProject(dir);
    const f = JSON.parse(readFileSync(join(dir, ".lanes/features.json"), "utf8"));
    const b = JSON.parse(readFileSync(join(dir, ".lanes/backlog.json"), "utf8"));
    expect(f).toEqual({ next_id_seq: 1, features: [] });
    expect(b).toEqual({ next_id_seq: 1, items: [] });
  });

  it("auto-inits git when target is not a repo, and returns initialised_git=true", () => {
    const dir = emptyDir();
    const r = initProject(dir);
    expect(r.initialised_git).toBe(true);
    const head = spawnSync("git", ["-C", dir, "rev-parse", "--git-dir"], { encoding: "utf8" });
    expect(head.status).toBe(0);
  });

  it("leaves an existing git repo alone, returning initialised_git=false", () => {
    const dir = emptyDir();
    spawnSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
    const r = initProject(dir);
    expect(r.initialised_git).toBe(false);
  });

  it("refuses to overwrite an existing .lanes/", () => {
    const dir = emptyDir();
    mkdirSync(join(dir, ".lanes"));
    expect(() => initProject(dir)).toThrow(/already exists/);
  });

  it("throws when target dir does not exist", () => {
    expect(() => initProject("/does/not/exist/lanes-init-xyz")).toThrow(/does not exist/);
  });
});
