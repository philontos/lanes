import { describe, it, expect } from "vitest";
import { featureDisplayStatus, projectDisplayStatus } from "../src/project/derive.js";
import type { ProjectFeature, ProjectItem, ItemStatus } from "../src/project/state.js";

const feature = (over: Partial<ProjectFeature> = {}): ProjectFeature => ({
  id: "feature-0001",
  title: "F",
  why: "",
  design_notes: "",
  lifecycle: "active",
  superseded_by: null,
  created_at: "",
  ...over,
});

const item = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: "item-0001",
  title: "I",
  feature_id: "feature-0001",
  acceptance: [],
  status: "todo" as ItemStatus,
  cycles: [],
  notes: "",
  superseded_by: null,
  created_at: "",
  completed_at: null,
  ...over,
});

describe("featureDisplayStatus", () => {
  it("returns dropped when feature lifecycle is dropped, regardless of items", () => {
    expect(featureDisplayStatus(feature({ lifecycle: "dropped" }), [item({ status: "in-progress" })])).toBe("dropped");
  });

  it("returns todo when there are no items", () => {
    expect(featureDisplayStatus(feature(), [])).toBe("todo");
  });

  it("returns todo when all items are dropped (treated as no items)", () => {
    expect(featureDisplayStatus(feature(), [
      item({ status: "dropped" }),
      item({ id: "item-0002", status: "dropped" }),
    ])).toBe("todo");
  });

  it("returns done when every non-dropped item is done", () => {
    expect(featureDisplayStatus(feature(), [
      item({ status: "done" }),
      item({ id: "item-0002", status: "done" }),
    ])).toBe("done");
  });

  it("returns done while ignoring dropped items", () => {
    expect(featureDisplayStatus(feature(), [
      item({ status: "done" }),
      item({ id: "item-0002", status: "dropped" }),
    ])).toBe("done");
  });

  it("returns in-progress when any item is in-progress (precedes blocked)", () => {
    expect(featureDisplayStatus(feature(), [
      item({ status: "in-progress" }),
      item({ id: "item-0002", status: "blocked" }),
    ])).toBe("in-progress");
  });

  it("returns blocked when any item is blocked and none in-progress", () => {
    expect(featureDisplayStatus(feature(), [
      item({ status: "todo" }),
      item({ id: "item-0002", status: "blocked" }),
    ])).toBe("blocked");
  });

  it("only considers items whose feature_id matches", () => {
    const f1 = feature({ id: "feature-0001" });
    expect(featureDisplayStatus(f1, [
      item({ feature_id: "feature-0001", status: "done" }),
      item({ id: "item-0002", feature_id: "feature-0002", status: "in-progress" }),
    ])).toBe("done");
  });
});

describe("projectDisplayStatus", () => {
  it("returns todo when there are no active features", () => {
    expect(projectDisplayStatus([], [])).toBe("todo");
    expect(projectDisplayStatus([feature({ lifecycle: "dropped" })], [item()])).toBe("todo");
  });

  it("returns done when every active feature is done", () => {
    expect(projectDisplayStatus(
      [feature({ id: "feature-0001" }), feature({ id: "feature-0002" })],
      [
        item({ id: "item-0001", feature_id: "feature-0001", status: "done" }),
        item({ id: "item-0002", feature_id: "feature-0002", status: "done" }),
      ],
    )).toBe("done");
  });

  it("returns in-progress if any feature is in-progress (regardless of others)", () => {
    expect(projectDisplayStatus(
      [feature({ id: "feature-0001" }), feature({ id: "feature-0002" })],
      [
        item({ id: "item-0001", feature_id: "feature-0001", status: "done" }),
        item({ id: "item-0002", feature_id: "feature-0002", status: "in-progress" }),
      ],
    )).toBe("in-progress");
  });

  it("returns blocked when any feature is blocked and none in-progress", () => {
    expect(projectDisplayStatus(
      [feature({ id: "feature-0001" }), feature({ id: "feature-0002" })],
      [
        item({ id: "item-0001", feature_id: "feature-0001", status: "done" }),
        item({ id: "item-0002", feature_id: "feature-0002", status: "blocked" }),
      ],
    )).toBe("blocked");
  });
});
