// Plugin provisioning: resolve which local plugin dirs to load, and validate that
// every skill named in lanes.config.json is actually provided by an installed
// plugin. Plugins are declared in plugins.json and baked into the image at build
// (see docker/install-plugins.sh); this module is the runtime side.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PHASES, skillsForPhase } from "./phases.js";

export type LocalPlugin = { type: "local"; path: string };

// A plugin's namespace — how its skills are referenced in config ("<name>:<skill>").
// Read from .claude-plugin/plugin.json; falls back to the directory name (install
// dirs are named after the manifest entry, so the fallback is also correct).
export function pluginName(dir: string): string {
  try {
    const name = JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).name;
    if (typeof name === "string" && name) return name;
  } catch { /* no manifest — use dir name */ }
  return dir.split("/").pop() ?? "";
}

const looksLikePlugin = (dir: string): boolean =>
  existsSync(join(dir, "skills")) || existsSync(join(dir, ".claude-plugin"));

// Local plugin dirs to hand to the Agent SDK. In the image every declared plugin is
// baked under $LANES_PLUGINS (one dir per plugin, installed from plugins.json). For
// dev runs outside the container, fall back to the highest-versioned superpowers in
// the host plugin cache. Fail loud if nothing is found — a missing plugin must not
// silently run empty.
export function resolvePlugins(env: { LANES_PLUGINS?: string; HOME?: string } = process.env): LocalPlugin[] {
  const root = env.LANES_PLUGINS;
  if (root && existsSync(root)) {
    const dirs = readdirSync(root).map((d) => join(root, d)).filter(looksLikePlugin);
    if (dirs.length) return dirs.map((path) => ({ type: "local", path }));
  }
  // dev fallback: host plugin cache (superpowers only; other plugins need the image).
  const cache = `${env.HOME}/.claude/plugins/cache`;
  const candidates: string[] = [];
  if (existsSync(cache)) {
    for (const mkt of readdirSync(cache)) {
      const sp = join(cache, mkt, "superpowers");
      if (!existsSync(sp)) continue;
      for (const ver of readdirSync(sp)) if (existsSync(join(sp, ver, "skills"))) candidates.push(join(sp, ver));
    }
  }
  candidates.sort();
  if (!candidates.length) {
    throw new Error("no plugins found — expected baked under $LANES_PLUGINS (Docker image) or superpowers under ~/.claude/plugins/cache for local dev");
  }
  return [{ type: "local", path: candidates[candidates.length - 1] }];
}

// Fail loud if a phase names a skill whose plugin namespace isn't among the loaded
// plugins — surfacing a config/manifest mismatch beats a silent skill no-op.
export function assertSkillsInstalled(config: any, plugins: LocalPlugin[]): void {
  const installed = new Set(plugins.map((p) => pluginName(p.path)));
  const missing: string[] = [];
  for (const phase of PHASES) {
    for (const s of skillsForPhase(config, phase)) {
      const ns = s.includes(":") ? s.split(":")[0] : s;
      if (!installed.has(ns)) missing.push(`${s} (needs plugin "${ns}")`);
    }
  }
  if (missing.length) {
    throw new Error(`plugins.json is missing skills referenced by lanes.config.json: ${[...new Set(missing)].join(", ")}. Add the plugin to plugins.json and rebuild the image.`);
  }
}
