import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readFeatures, writeFeatures, readBacklog, writeBacklog,
  validateSpec, REQUIRED_SPEC_SECTIONS, lanesDir,
  type ProjectFeaturesFile, type ProjectBacklogFile,
} from "../src/project/state.js";

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "lanes-state-"));
  mkdirSync(join(repo, ".lanes"));
  return repo;
}

describe("lanesDir", () => {
  it("joins repo root with .lanes", () => {
    expect(lanesDir("/a/b")).toBe("/a/b/.lanes");
  });
});

describe("features.json I/O", () => {
  it("round-trips a file with one feature", () => {
    const repo = makeRepo();
    const data: ProjectFeaturesFile = {
      next_id_seq: 2,
      features: [{
        id: "feature-0001",
        title: "Forge lane orchestration",
        why: "Drive spec→plan→impl→review automatically.",
        design_notes: "",
        lifecycle: "active",
        superseded_by: null,
        created_at: "2026-05-28T12:00:00Z",
      }],
    };
    writeFeatures(repo, data);
    expect(readFeatures(repo)).toEqual(data);
  });

  it("round-trips an empty features file", () => {
    const repo = makeRepo();
    const data: ProjectFeaturesFile = { next_id_seq: 1, features: [] };
    writeFeatures(repo, data);
    expect(readFeatures(repo)).toEqual(data);
  });
});

describe("backlog.json I/O", () => {
  it("round-trips a file with one item", () => {
    const repo = makeRepo();
    const data: ProjectBacklogFile = {
      next_id_seq: 2,
      items: [{
        id: "item-0001",
        title: "Implement spec phase",
        feature_id: "feature-0001",
        acceptance: ["spec.md is produced"],
        status: "todo",
        cycles: [],
        notes: "",
        superseded_by: null,
        created_at: "2026-05-28T11:00:00Z",
        completed_at: null,
      }],
    };
    writeBacklog(repo, data);
    expect(readBacklog(repo)).toEqual(data);
  });

  it("round-trips an empty backlog", () => {
    const repo = makeRepo();
    const data: ProjectBacklogFile = { next_id_seq: 1, items: [] };
    writeBacklog(repo, data);
    expect(readBacklog(repo)).toEqual(data);
  });
});

describe("validateSpec", () => {
  it("accepts a spec with all six required H2 sections", () => {
    const md = REQUIRED_SPEC_SECTIONS.map((s) => `## ${s}\nbody\n`).join("\n");
    expect(validateSpec(md)).toEqual({ ok: true });
  });

  it("accepts sections regardless of order", () => {
    const md = [
      "## Constraints", "x", "## Open Questions", "x", "## Success Criteria", "x",
      "## Scope OUT", "x", "## Scope IN", "x", "## Goal", "x",
    ].join("\n");
    expect(validateSpec(md)).toEqual({ ok: true });
  });

  it("flags missing sections, preserving canonical order in the missing[] list", () => {
    const md = "## Goal\nbody\n## Scope IN\nbody\n";
    expect(validateSpec(md)).toEqual({
      ok: false,
      missing: ["Scope OUT", "Success Criteria", "Open Questions", "Constraints"],
    });
  });

  it("ignores trailing whitespace on H2 lines", () => {
    const md = REQUIRED_SPEC_SECTIONS.map((s) => `## ${s}   \nbody\n`).join("\n");
    expect(validateSpec(md)).toEqual({ ok: true });
  });

  it("does not match H3 or deeper headings as sections", () => {
    const md = "### Goal\nbody\n";
    const r = validateSpec(md);
    expect(r.ok).toBe(false);
  });
});
