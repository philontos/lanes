import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  applyCycleOutcome, applyItemInProgress,
  writeIntegrationNotes, commitProjectStateChange,
  type CycleOutcome,
} from "../src/project/integration.js";
import type { ProjectItem } from "../src/project/state.js";

const item = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: "item-0001",
  title: "Test item",
  feature_id: "feature-0001",
  acceptance: [],
  status: "todo",
  cycles: [],
  notes: "",
  superseded_by: null,
  created_at: "",
  completed_at: null,
  ...over,
});

function setupRepo(items: ProjectItem[]): string {
  const repo = mkdtempSync(join(tmpdir(), "lanes-integ-"));
  mkdirSync(join(repo, ".lanes"));
  writeFileSync(
    join(repo, ".lanes/backlog.json"),
    JSON.stringify({ next_id_seq: items.length + 1, items }, null, 2),
  );
  return repo;
}

const FIXED_NOW = (): Date => new Date("2026-05-28T12:34:56Z");

describe("applyItemInProgress", () => {
  it("flips item.status to in-progress", () => {
    const repo = setupRepo([item()]);
    applyItemInProgress(repo, "item-0001");
    const b = JSON.parse(readFileSync(join(repo, ".lanes/backlog.json"), "utf8"));
    expect(b.items[0].status).toBe("in-progress");
  });

  it("throws when item is missing", () => {
    const repo = setupRepo([item()]);
    expect(() => applyItemInProgress(repo, "item-9999")).toThrow(/not in backlog/);
  });
});

describe("applyCycleOutcome", () => {
  const outcomePass: CycleOutcome = { cycle_id: "cycle-X", status: "success", verdict: "pass" };
  const outcomeReject: CycleOutcome = { cycle_id: "cycle-X", status: "blocked", verdict: "reject", reason: "exhausted retries" };
  const outcomeFail: CycleOutcome = { cycle_id: "cycle-X", status: "blocked", reason: "phase threw" };

  it("success + pass → status done, completed_at set, cycle appended", () => {
    const repo = setupRepo([item()]);
    const r = applyCycleOutcome(repo, "item-0001", outcomePass, FIXED_NOW);
    expect(r.status).toBe("done");
    const b = JSON.parse(readFileSync(join(repo, ".lanes/backlog.json"), "utf8"));
    expect(b.items[0].status).toBe("done");
    expect(b.items[0].completed_at).toBe("2026-05-28T12:34:56.000Z");
    expect(b.items[0].cycles).toEqual([
      { cycle_id: "cycle-X", verdict: "pass", at: "2026-05-28T12:34:56.000Z" },
    ]);
  });

  it("review reject → status blocked, cycle appended, completed_at stays null", () => {
    const repo = setupRepo([item()]);
    const r = applyCycleOutcome(repo, "item-0001", outcomeReject, FIXED_NOW);
    expect(r.status).toBe("blocked");
    const b = JSON.parse(readFileSync(join(repo, ".lanes/backlog.json"), "utf8"));
    expect(b.items[0].status).toBe("blocked");
    expect(b.items[0].completed_at).toBeNull();
    expect(b.items[0].cycles[0].verdict).toBe("reject");
  });

  it("phase failure (no verdict) → status blocked, cycle.verdict = 'fail'", () => {
    const repo = setupRepo([item()]);
    applyCycleOutcome(repo, "item-0001", outcomeFail, FIXED_NOW);
    const b = JSON.parse(readFileSync(join(repo, ".lanes/backlog.json"), "utf8"));
    expect(b.items[0].status).toBe("blocked");
    expect(b.items[0].cycles[0].verdict).toBe("fail");
  });

  it("appends to existing cycles[] history", () => {
    const repo = setupRepo([item({
      cycles: [{ cycle_id: "cycle-OLD", verdict: "reject", at: "2026-05-27T00:00:00Z" }],
    })]);
    applyCycleOutcome(repo, "item-0001", outcomePass, FIXED_NOW);
    const b = JSON.parse(readFileSync(join(repo, ".lanes/backlog.json"), "utf8"));
    expect(b.items[0].cycles).toHaveLength(2);
    expect(b.items[0].cycles[0].cycle_id).toBe("cycle-OLD");
    expect(b.items[0].cycles[1].cycle_id).toBe("cycle-X");
  });

  it("dropped items are not modified", () => {
    const repo = setupRepo([item({ status: "dropped" })]);
    const r = applyCycleOutcome(repo, "item-0001", outcomePass, FIXED_NOW);
    expect(r.status).toBe("dropped");
    const b = JSON.parse(readFileSync(join(repo, ".lanes/backlog.json"), "utf8"));
    expect(b.items[0].status).toBe("dropped");
    expect(b.items[0].cycles).toEqual([]);
  });

  it("throws when item is missing", () => {
    const repo = setupRepo([item()]);
    expect(() => applyCycleOutcome(repo, "item-9999", outcomePass)).toThrow(/not in backlog/);
  });
});

describe("writeIntegrationNotes", () => {
  it("writes a markdown file with the expected sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "lanes-notes-"));
    writeIntegrationNotes(dir, {
      item_id: "item-0042",
      item_title: "Wire up something",
      outcome: { cycle_id: "cycle-Y", status: "success", verdict: "pass" },
      new_status: "done",
    });
    const md = readFileSync(join(dir, "integration-notes.md"), "utf8");
    expect(md).toContain("# Integration notes — item-0042");
    expect(md).toContain("Item: Wire up something");
    expect(md).toContain("Outcome: success (verdict: pass)");
    expect(md).toContain("item item-0042 → status = done");
    expect(md).toContain("Suggested follow-ups");
  });

  it("includes Reason line when outcome includes a reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "lanes-notes-"));
    writeIntegrationNotes(dir, {
      item_id: "item-0001",
      item_title: "T",
      outcome: { cycle_id: "cycle-Z", status: "blocked", reason: "spec phase exceeded maxTurns" },
      new_status: "blocked",
    });
    const md = readFileSync(join(dir, "integration-notes.md"), "utf8");
    expect(md).toContain("Reason: spec phase exceeded maxTurns");
  });
});

describe("commitProjectStateChange", () => {
  function gitRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), "lanes-git-"));
    const opts = { cwd: repo, stdio: "ignore" } as const;
    spawnSync("git", ["init", "-q"], opts);
    spawnSync("git", ["config", "user.email", "test@example.com"], opts);
    spawnSync("git", ["config", "user.name", "Test"], opts);
    spawnSync("git", ["config", "commit.gpgsign", "false"], opts);
    mkdirSync(join(repo, ".lanes"));
    writeFileSync(join(repo, ".lanes/backlog.json"), '{"next_id_seq":1,"items":[]}\n');
    spawnSync("git", ["add", "."], opts);
    spawnSync("git", ["commit", "-q", "-m", "initial"], opts);
    return repo;
  }

  it("commits when .lanes/ has staged changes", () => {
    const repo = gitRepo();
    writeFileSync(join(repo, ".lanes/backlog.json"), '{"next_id_seq":2,"items":[]}\n');
    const r = commitProjectStateChange(repo, "lanes: test commit");
    expect(r.committed).toBe(true);
    const log = spawnSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
    expect(log.stdout).toContain("lanes: test commit");
  });

  it("returns committed:false when there are no changes (no-op)", () => {
    const repo = gitRepo();
    const r = commitProjectStateChange(repo, "lanes: should not commit");
    expect(r.committed).toBe(false);
  });
});
