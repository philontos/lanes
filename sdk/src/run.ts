import { runPhase } from "./orchestrator.js";

// usage: tsx src/run.ts --auto <worktreeDir> [lane] [phase]
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const [worktreeDir, lane = "forge", phase = "spec"] = args.filter((a) => !a.startsWith("--"));
if (!auto || !worktreeDir) { console.error("usage: run.ts --auto <worktreeDir> [lane] [phase]"); process.exit(1); }

try {
  const res = await runPhase({
    worktreeDir,
    commandsDir: `${process.env.HOME}/.claude/commands`,
    lane, phase,
    principlesPath: `${process.env.HOME}/Develop/personal/lanes/principles.md`,
  });
  console.log("PHASE RESULT:", (res as any)?.subtype);
  if ((res as any)?.subtype !== "success") process.exit(1);
} catch (e) {
  console.error("PHASE ERROR:", e);
  process.exit(1);
}
