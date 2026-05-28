// Post-cycle integration: write cycle outcome back into .lanes/backlog.json on
// the cycle's branch, and drop integration-notes.md into the cycle dir. Per the
// branch-based docs model, these mutations live on lanes/<cycle-id> and only
// reach main when the user merges — there is no auto-write to main here.
//
// Pure state changes are in `applyItemInProgress` / `applyCycleOutcome` (no git
// I/O). `commitProjectStateChange` is a separate, optional step the runtime
// invokes after writing, so unit tests don't need a real git repo.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBacklog, writeBacklog, type ItemStatus } from "./state.js";

export interface CycleOutcome {
  cycle_id: string;
  status: "success" | "blocked";        // overall cycle outcome
  verdict?: "pass" | "reject" | string; // present when review ran; "pass" → done, else blocked
  reason?: string;                       // human note for blocked outcomes
}

export interface ApplyResult {
  status: ItemStatus;
}

// Mark an item in-progress at cycle start. Used so the workspace view shows the
// item as live during the run, on the cycle's branch.
export function applyItemInProgress(repoRoot: string, itemId: string): void {
  const backlog = readBacklog(repoRoot);
  const idx = backlog.items.findIndex((i) => i.id === itemId);
  if (idx < 0) throw new Error(`item ${itemId} not in backlog.json`);
  backlog.items[idx] = { ...backlog.items[idx], status: "in-progress" };
  writeBacklog(repoRoot, backlog);
}

// Apply the cycle outcome to the item: status, cycles[], completed_at.
// success + verdict=="pass" → done; anything else → blocked. The item already
// being "dropped" is intentionally NOT overridden (a dropped item shouldn't
// have been run, but if it was, leave its status as dropped).
export function applyCycleOutcome(
  repoRoot: string,
  itemId: string,
  outcome: CycleOutcome,
  now: () => Date = () => new Date(),
): ApplyResult {
  const backlog = readBacklog(repoRoot);
  const idx = backlog.items.findIndex((i) => i.id === itemId);
  if (idx < 0) throw new Error(`item ${itemId} not in backlog.json`);
  const cur = backlog.items[idx];
  if (cur.status === "dropped") return { status: "dropped" };

  const nowIso = now().toISOString();
  const newStatus: ItemStatus =
    outcome.status === "success" && outcome.verdict === "pass" ? "done" : "blocked";

  backlog.items[idx] = {
    ...cur,
    status: newStatus,
    cycles: [
      ...cur.cycles,
      { cycle_id: outcome.cycle_id, verdict: outcome.verdict ?? "fail", at: nowIso },
    ],
    completed_at: newStatus === "done" ? nowIso : cur.completed_at,
  };
  writeBacklog(repoRoot, backlog);
  return { status: newStatus };
}

// Write the integration-notes.md companion file into the cycle dir. Independent
// of state changes — kept separate so it can be written even when the cycle did
// not modify state (e.g. a phase threw before integration).
export function writeIntegrationNotes(
  cycleDir: string,
  params: {
    item_id: string;
    item_title: string;
    outcome: CycleOutcome;
    new_status: ItemStatus;
  },
): void {
  const verdictLine = params.outcome.verdict ? ` (verdict: ${params.outcome.verdict})` : "";
  const lines = [
    `# Integration notes — ${params.item_id}`,
    "",
    `Item: ${params.item_title}`,
    `Cycle: ${params.outcome.cycle_id}`,
    `Outcome: ${params.outcome.status}${verdictLine}`,
    ...(params.outcome.reason ? ["", `Reason: ${params.outcome.reason}`] : []),
    "",
    "## What this cycle wrote to .lanes/ on its branch",
    "",
    `- backlog.json: item ${params.item_id} → status = ${params.new_status}, cycle appended to cycles[]`,
    "",
    "## Suggested follow-ups (human-driven only)",
    "",
    "Review this cycle's artifacts (spec.md / plan.md / review.md in this cycle dir).",
    "If you want to update upstream `.lanes/spec.md`, `.lanes/plan.md`, or `.lanes/features.json` to",
    "reflect what was learned in this cycle, edit them by hand on this branch before merging to main.",
    "Per project convention, the cycle never auto-edits those upper-layer files.",
    "",
  ];
  writeFileSync(join(cycleDir, "integration-notes.md"), lines.join("\n"));
}

// Commit current .lanes/ changes on whatever branch is checked out. Best-effort:
// if there is nothing staged after `git add`, `git commit` exits non-zero and we
// swallow it — the caller is robust to no-op commits (e.g. when state was
// already up to date). Throws only when git itself is unavailable.
export function commitProjectStateChange(repoRoot: string, message: string): { committed: boolean } {
  const add = spawnSync("git", ["-C", repoRoot, "add", ".lanes"], { stdio: "ignore" });
  if (add.status !== 0) {
    throw new Error(`git add failed in ${repoRoot}`);
  }
  // `--allow-empty=no` is implicit; if nothing changed the commit no-ops.
  const commit = spawnSync(
    "git",
    ["-C", repoRoot, "commit", "-m", message, "--", ".lanes"],
    { stdio: "ignore" },
  );
  return { committed: commit.status === 0 };
}
