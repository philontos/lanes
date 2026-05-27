import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlugins, assertSkillsInstalled, pluginName } from "../src/plugins.js";

function makePlugin(root: string, name: string, opts: { skills?: boolean; manifestName?: string } = {}) {
  const dir = join(root, name);
  if (opts.skills !== false) mkdirSync(join(dir, "skills"), { recursive: true });
  if (opts.manifestName) {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: opts.manifestName }));
  }
  return dir;
}

describe("resolvePlugins", () => {
  it("loads every plugin dir baked under $LANES_PLUGINS, ignoring non-plugins", () => {
    const root = mkdtempSync(join(tmpdir(), "plugins-"));
    makePlugin(root, "superpowers");
    makePlugin(root, "frontend-design", { skills: false, manifestName: "frontend-design" });
    mkdirSync(join(root, "not-a-plugin")); // no skills/ or .claude-plugin/ -> ignored
    const got = resolvePlugins({ LANES_PLUGINS: root }).map((p) => p.path.split("/").pop()).sort();
    expect(got).toEqual(["frontend-design", "superpowers"]);
  });
  it("falls back to the host-cache superpowers for dev runs (no $LANES_PLUGINS)", () => {
    const home = mkdtempSync(join(tmpdir(), "home-"));
    const sp = join(home, ".claude/plugins/cache/mkt/superpowers/5.1.0");
    mkdirSync(join(sp, "skills"), { recursive: true });
    const got = resolvePlugins({ HOME: home });
    expect(got).toHaveLength(1);
    expect(got[0].path).toBe(sp);
  });
  it("fails loud when no plugins are found anywhere", () => {
    const home = mkdtempSync(join(tmpdir(), "home-"));
    expect(() => resolvePlugins({ HOME: home })).toThrow(/no plugins found/);
  });
});

describe("pluginName", () => {
  it("reads .claude-plugin/plugin.json name, else falls back to the dir name", () => {
    const root = mkdtempSync(join(tmpdir(), "pn-"));
    const a = makePlugin(root, "verdir", { manifestName: "superpowers" });
    const b = makePlugin(root, "frontend-design");
    expect(pluginName(a)).toBe("superpowers");
    expect(pluginName(b)).toBe("frontend-design");
  });
});

describe("assertSkillsInstalled", () => {
  const cfg = { phases: { spec: { skill: "superpowers:brainstorming" }, impl: { skills: ["superpowers:test-driven-development"] }, review: { skill: null } } };
  it("passes when every named skill's plugin is installed", () => {
    const root = mkdtempSync(join(tmpdir(), "ai-"));
    const sp = makePlugin(root, "superpowers", { manifestName: "superpowers" });
    expect(() => assertSkillsInstalled(cfg, [{ type: "local", path: sp }])).not.toThrow();
  });
  it("fails loud naming the missing plugin", () => {
    const root = mkdtempSync(join(tmpdir(), "ai-"));
    const sp = makePlugin(root, "superpowers", { manifestName: "superpowers" });
    const cfg2 = { phases: { spec: { skill: "frontend-design:frontend-design" } } };
    expect(() => assertSkillsInstalled(cfg2, [{ type: "local", path: sp }])).toThrow(/frontend-design/);
  });
});
