import { runLane } from "./orchestrator.js";

// usage: tsx sdk/src/run.ts --auto <worktreeDir> [lane] [phase]
// Lane defaults to "forge"; phase defaults to the lane's first phase. The web
// has its own entry at web/src/run.ts.
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const positional = args.filter((a) => !a.startsWith("--"));
const [worktreeDir, laneRaw, phaseRaw] = positional;
if (!auto || !worktreeDir) {
  console.error("usage: run.ts --auto <worktreeDir> [lane] [phase]");
  process.exit(1);
}

const lane = laneRaw || "forge";
// Resolve default phase from the chosen lane's first entry (matches previous "spec" default for forge).
// We lazy-import to avoid pulling phases into the type-only scope before args parse.
const { phasesForLane } = await import("./phases.js");
const phase = phaseRaw || phasesForLane(lane)[0] || "spec";

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
    lane,
    startPhase: phase,
  });
  console.log("LANE RESULT:", (res as any)?.subtype);
  if ((res as any)?.subtype !== "success") process.exit(1);
} catch (e) {
  console.error("LANE ERROR:", e);
  process.exit(1);
}
