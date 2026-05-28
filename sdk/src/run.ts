import { runLane } from "./orchestrator.js";

// usage:
//   tsx src/run.ts --auto <worktreeDir> [lane] [phase]   drive a cycle (existing)
//   tsx src/run.ts --web                                 start the local web (new)
// (lane is accepted positionally for compatibility but ignored — only forge is wired.)
const args = process.argv.slice(2);

if (args.includes("--web")) {
  const { startServer } = await import("./web/server.js");
  startServer();
  // startServer returns immediately; the http server keeps the process alive.
} else {

const auto = args.includes("--auto");
const [worktreeDir, , phase = "spec"] = args.filter((a) => !a.startsWith("--"));
if (!auto || !worktreeDir) { console.error("usage: run.ts --auto <worktreeDir> [lane] [phase]"); process.exit(1); }

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

}  // end else (cycle mode)

