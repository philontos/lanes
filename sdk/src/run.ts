import { runLane } from "./orchestrator.js";

// usage: tsx sdk/src/run.ts --auto <worktreeDir> [lane] [phase]
// (lane is accepted positionally for compatibility but ignored — only forge is wired.)
// The web has its own entry at web/src/run.ts.
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const [worktreeDir, , phase = "spec"] = args.filter((a) => !a.startsWith("--"));
if (!auto || !worktreeDir) {
  console.error("usage: run.ts --auto <worktreeDir> [lane] [phase]");
  process.exit(1);
}

// Repo root holding lanes.config.json + judge-principles.md. In the container this is the
// mount point passed as LANES_REPO; for dev runs outside Docker, fall back to the
// conventional clone path.
const repo = process.env.LANES_REPO ?? `${process.env.HOME}/Develop/personal/lanes`;

try {
  const res = await runLane({
    worktreeDir,
    configPath: `${repo}/lanes.config.json`,
    principlesPath: `${repo}/judge-principles.md`,
    rubricPath: `${repo}/engineering-rubric.md`,
    designPrinciplesPath: `${repo}/design-principles.md`,
    startPhase: phase,
  });
  console.log("LANE RESULT:", (res as any)?.subtype);
  if ((res as any)?.subtype !== "success") process.exit(1);
} catch (e) {
  console.error("LANE ERROR:", e);
  process.exit(1);
}
