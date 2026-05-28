import { describe, it, expect } from "vitest";
import { composeRequest, extractSpecSection, synthesizeRequest } from "../src/project/synthesize.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectFeature, ProjectItem } from "../src/project/state.js";

const feature = (over: Partial<ProjectFeature> = {}): ProjectFeature => ({
  id: "feature-0001",
  title: "Forge lane",
  why: "Drive spec→plan→impl→review automatically.",
  design_notes: "",
  lifecycle: "active",
  superseded_by: null,
  created_at: "",
  ...over,
});

const item = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: "item-0001",
  title: "Implement review gate retry",
  feature_id: "feature-0001",
  acceptance: ["verdict reject re-runs impl up to 2 times", "exhausted retries blocks the cycle"],
  status: "todo",
  cycles: [],
  notes: "",
  superseded_by: null,
  created_at: "",
  completed_at: null,
  ...over,
});

describe("extractSpecSection", () => {
  const SPEC = [
    "## Goal", "Build the thing.", "Across multiple lines.",
    "", "## Scope IN", "- one", "- two",
    "", "## Scope OUT", "- not yet",
  ].join("\n");

  it("returns the body of a section between two ## headings", () => {
    expect(extractSpecSection(SPEC, "Goal")).toBe("Build the thing.\nAcross multiple lines.");
  });
  it("returns the body of the last section (no following heading)", () => {
    expect(extractSpecSection(SPEC, "Scope OUT")).toBe("- not yet");
  });
  it("returns empty for a missing section", () => {
    expect(extractSpecSection(SPEC, "Nonexistent")).toBe("");
  });
  it("handles section names with regex-special chars safely", () => {
    const md = "## Foo (bar)\nbody\n";
    expect(extractSpecSection(md, "Foo (bar)")).toBe("body");
  });
});

describe("composeRequest", () => {
  it("includes item title and acceptance bullets", () => {
    const r = composeRequest({ item: item(), feature: null, spec: "", plan: "" });
    expect(r).toContain("Item: Implement review gate retry");
    expect(r).toContain("- verdict reject re-runs impl up to 2 times");
    expect(r).toContain("- exhausted retries blocks the cycle");
  });

  it("omits acceptance block when item has no acceptance criteria", () => {
    const r = composeRequest({ item: item({ acceptance: [] }), feature: null, spec: "", plan: "" });
    expect(r).not.toContain("Acceptance criteria");
  });

  it("includes feature title and why when a feature is given", () => {
    const r = composeRequest({ item: item(), feature: feature(), spec: "", plan: "" });
    expect(r).toContain("Belongs to feature feature-0001 — Forge lane");
    expect(r).toContain("Why this feature exists: Drive spec→plan→impl→review automatically.");
  });

  it("includes design_notes when non-empty", () => {
    const f = feature({ design_notes: "Use Claude Agent SDK with a per-phase canUseTool gate." });
    const r = composeRequest({ item: item(), feature: f, spec: "", plan: "" });
    expect(r).toContain("Per-feature design notes:");
    expect(r).toContain("Use Claude Agent SDK with a per-phase canUseTool gate.");
  });

  it("includes Goal section when present and non-placeholder", () => {
    const spec = "## Goal\nDrive structured work to code.\n";
    const r = composeRequest({ item: item(), feature: null, spec, plan: "" });
    expect(r).toContain("=== Project goal (from .lanes/spec.md) ===");
    expect(r).toContain("Drive structured work to code.");
  });

  it("skips Goal section when it is a (none yet) placeholder", () => {
    const spec = "## Goal\n(none yet)\n";
    const r = composeRequest({ item: item(), feature: null, spec, plan: "" });
    expect(r).not.toContain("=== Project goal");
  });

  it("includes Scope IN and Scope OUT when present", () => {
    const spec = "## Scope IN\n- a\n\n## Scope OUT\n- b — reason\n";
    const r = composeRequest({ item: item(), feature: null, spec, plan: "" });
    expect(r).toContain("=== Project scope");
    expect(r).toContain("IN:");
    expect(r).toContain("- a");
    expect(r).toContain("OUT:");
    expect(r).toContain("- b — reason");
  });

  it("skips scope block when both Scope IN and Scope OUT are placeholders", () => {
    const spec = "## Scope IN\n- (none yet)\n\n## Scope OUT\n- (none yet)\n";
    const r = composeRequest({ item: item(), feature: null, spec, plan: "" });
    expect(r).not.toContain("=== Project scope");
  });

  it("includes plan body when non-empty and not a TBD placeholder", () => {
    const plan = "# Tech Plan\n\nTS + vitest. Module layout per existing sdk/src structure.";
    const r = composeRequest({ item: item(), feature: null, spec: "", plan });
    expect(r).toContain("=== Project tech foundation (from .lanes/plan.md) ===");
    expect(r).toContain("TS + vitest");
  });

  it("skips plan when it is the post-init TBD placeholder", () => {
    const plan = "# Tech Plan\n\n(TBD — short global technical foundation: stack, etc.)\n";
    const r = composeRequest({ item: item(), feature: null, spec: "", plan });
    expect(r).not.toContain("=== Project tech foundation");
  });

  it("always ends with the directive to complete the item", () => {
    const r = composeRequest({ item: item(), feature: null, spec: "", plan: "" });
    expect(r).toMatch(/Complete this item per the acceptance criteria above/);
  });
});

describe("synthesizeRequest (filesystem)", () => {
  function setup(items: ProjectItem[], features: ProjectFeature[], spec = "", plan = ""): string {
    const repo = mkdtempSync(join(tmpdir(), "lanes-synth-"));
    mkdirSync(join(repo, ".lanes"));
    writeFileSync(join(repo, ".lanes/backlog.json"), JSON.stringify({ next_id_seq: items.length + 1, items }));
    writeFileSync(join(repo, ".lanes/features.json"), JSON.stringify({ next_id_seq: features.length + 1, features }));
    writeFileSync(join(repo, ".lanes/spec.md"), spec);
    writeFileSync(join(repo, ".lanes/plan.md"), plan);
    return repo;
  }

  it("composes a full request from disk", () => {
    const repo = setup(
      [item()],
      [feature({ design_notes: "Use the SDK." })],
      "## Goal\nShip it.\n",
      "# Tech Plan\n\nTS + vitest.",
    );
    const r = synthesizeRequest(repo, "item-0001");
    expect(r).toContain("Item: Implement review gate retry");
    expect(r).toContain("Belongs to feature feature-0001");
    expect(r).toContain("Use the SDK.");
    expect(r).toContain("Ship it.");
    expect(r).toContain("TS + vitest");
  });

  it("throws when the item is not found", () => {
    const repo = setup([item()], []);
    expect(() => synthesizeRequest(repo, "item-9999")).toThrow(/not found/);
  });

  it("throws when the item is dropped", () => {
    const repo = setup([item({ status: "dropped" })], []);
    expect(() => synthesizeRequest(repo, "item-0001")).toThrow(/dropped/);
  });

  it("degrades gracefully when the feature is missing", () => {
    const repo = setup([item({ feature_id: "feature-9999" })], [feature()]);
    const r = synthesizeRequest(repo, "item-0001");
    expect(r).toContain("Item:");
    expect(r).not.toContain("Belongs to feature");
  });

  it("degrades gracefully when spec.md is absent", () => {
    const repo = mkdtempSync(join(tmpdir(), "lanes-synth-"));
    mkdirSync(join(repo, ".lanes"));
    writeFileSync(join(repo, ".lanes/backlog.json"), JSON.stringify({ next_id_seq: 2, items: [item()] }));
    writeFileSync(join(repo, ".lanes/features.json"), JSON.stringify({ next_id_seq: 1, features: [] }));
    // no spec.md, no plan.md
    const r = synthesizeRequest(repo, "item-0001");
    expect(r).toContain("Item:");
    expect(r).not.toContain("=== Project goal");
  });
});
