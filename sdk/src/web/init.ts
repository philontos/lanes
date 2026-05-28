// TS twin of sdk/docker/lanes-init.sh. The web triggers init via this module
// (avoids shelling out, makes the behaviour unit-testable). Same shape and same
// invariants: refuse to overwrite an existing .lanes/, auto-init git if absent,
// produce the six fixed H2 sections in spec.md.

import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";

const FEATURES_INITIAL = `{
  "next_id_seq": 1,
  "features": []
}
`;

const BACKLOG_INITIAL = `{
  "next_id_seq": 1,
  "items": []
}
`;

const SPEC_INITIAL = `## Goal
(none yet — write 1–3 paragraphs of product intent: who, what experience, why now.)

## Scope IN
- (none yet)

## Scope OUT
- (none yet)

## Success Criteria
- (none yet)

## Open Questions
(none yet)

## Constraints
(none yet)
`;

const PLAN_INITIAL = `# Tech Plan

(TBD — short global technical foundation: stack, architecture, cross-feature key decisions.
Per-feature implementation details live in each feature's \`design_notes\` field in features.json.)
`;

const summaryInitial = (name: string): string =>
  `# ${name}\n\n(TBD — one paragraph: what this project is and what problem it solves.)\n`;

export interface InitResult {
  path: string;
  initialised_git: boolean;
}

export function initProject(projectPath: string): InitResult {
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    throw new Error(`target dir '${projectPath}' does not exist`);
  }
  const lanesDir = join(projectPath, ".lanes");
  if (existsSync(lanesDir)) {
    throw new Error(`.lanes/ already exists in ${projectPath}; refusing to overwrite`);
  }

  let initialised_git = false;
  if (!existsSync(join(projectPath, ".git"))) {
    const r = spawnSync("git", ["-C", projectPath, "init", "-q"], { stdio: "ignore" });
    if (r.status !== 0) throw new Error(`git init failed in ${projectPath}`);
    initialised_git = true;
  }

  mkdirSync(lanesDir);
  const name = basename(projectPath);
  writeFileSync(join(lanesDir, "summary.md"), summaryInitial(name));
  writeFileSync(join(lanesDir, "spec.md"), SPEC_INITIAL);
  writeFileSync(join(lanesDir, "features.json"), FEATURES_INITIAL);
  writeFileSync(join(lanesDir, "plan.md"), PLAN_INITIAL);
  writeFileSync(join(lanesDir, "backlog.json"), BACKLOG_INITIAL);

  return { path: lanesDir, initialised_git };
}
