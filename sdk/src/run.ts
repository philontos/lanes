import { runLane } from "./orchestrator.js";

// usage: tsx src/run.ts --auto <worktreeDir> [lane] [phase]
// (lane is accepted positionally for compatibility but ignored — only forge is wired.)
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const [worktreeDir, , phase = "spec"] = args.filter((a) => !a.startsWith("--"));
if (!auto || !worktreeDir) { console.error("usage: run.ts --auto <worktreeDir> [lane] [phase]"); process.exit(1); }

try {
  const res = await runLane({
    worktreeDir,
    configPath: `${process.env.HOME}/Develop/personal/lanes/lanes.config.json`,
    principlesPath: `${process.env.HOME}/Develop/personal/lanes/principles.md`,
    startPhase: phase,
  });
  console.log("LANE RESULT:", (res as any)?.subtype);
  if ((res as any)?.subtype !== "success") process.exit(1);
} catch (e) {
  console.error("LANE ERROR:", e);
  process.exit(1);
}
