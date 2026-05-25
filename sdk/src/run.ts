import { runLane } from "./orchestrator.js";

// usage: tsx src/run.ts --auto <worktreeDir> [lane] [phase]
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const [worktreeDir, lane = "forge", phase = "spec"] = args.filter((a) => !a.startsWith("--"));
if (!auto || !worktreeDir) { console.error("usage: run.ts --auto <worktreeDir> [lane] [phase]"); process.exit(1); }

try {
  const res = await runLane({
    worktreeDir,
    commandsDir: `${process.env.HOME}/.claude/commands`,
    lane,
    principlesPath: `${process.env.HOME}/Develop/personal/lanes/principles.md`,
    startPhase: phase,
  });
  console.log("LANE RESULT:", (res as any)?.subtype);
  if ((res as any)?.subtype !== "success") process.exit(1);
} catch (e) {
  console.error("LANE ERROR:", e);
  process.exit(1);
}
