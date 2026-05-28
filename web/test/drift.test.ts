import { describe, it, expect } from "vitest";
import { checkDrift } from "../src/drift.js";
import type { ProjectFeature, ProjectItem } from "../../sdk/src/project/state.js";

const F = (over: Partial<ProjectFeature> = {}): ProjectFeature => ({
  id: "feature-0001", title: "F", why: "", design_notes: "",
  lifecycle: "active", superseded_by: null, created_at: "",
  ...over,
});
const I = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: "item-0001", title: "I", feature_id: "feature-0001",
  acceptance: [], status: "todo", cycles: [], notes: "",
  superseded_by: null, created_at: "", completed_at: null,
  ...over,
});

describe("checkDrift", () => {
  it("clean state has total 0", () => {
    const features = [F({ id: "feature-0001" })];
    const items = [I({ feature_id: "feature-0001" })];
    expect(checkDrift(features, items).total).toBe(0);
  });

  it("flags items pointing at non-existent features", () => {
    // anchor item-0002 on feature-0001 so 'unused' isn't also flagged here
    const features = [F({ id: "feature-0001" })];
    const items = [
      I({ id: "item-0001", feature_id: "feature-9999" }),
      I({ id: "item-0002", feature_id: "feature-0001" }),
    ];
    const d = checkDrift(features, items);
    expect(d.item_feature_missing).toEqual([
      { item_id: "item-0001", feature_id: "feature-9999", title: "I" },
    ]);
    expect(d.total).toBe(1);
  });

  it("does NOT flag dropped items with dangling feature refs (tombstones allowed)", () => {
    const features = [F({ id: "feature-0001" })];
    const items = [I({ id: "item-0001", feature_id: "feature-9999", status: "dropped" })];
    expect(checkDrift(features, items).item_feature_missing).toEqual([]);
  });

  it("flags non-dropped items pointing at dropped features", () => {
    const features = [F({ id: "feature-0001", lifecycle: "dropped" })];
    const items = [I({ id: "item-0001", feature_id: "feature-0001" })];
    const d = checkDrift(features, items);
    expect(d.item_feature_dropped).toEqual([
      { item_id: "item-0001", feature_id: "feature-0001", title: "I" },
    ]);
  });

  it("flags features whose superseded_by points nowhere", () => {
    const features = [F({ id: "feature-0001", lifecycle: "dropped", superseded_by: "feature-9999" })];
    const d = checkDrift(features, []);
    expect(d.feature_superseded_dangling).toEqual([
      { feature_id: "feature-0001", superseded_by: "feature-9999" },
    ]);
  });

  it("flags active features with no items referencing them", () => {
    const features = [
      F({ id: "feature-0001" }),                   // unused
      F({ id: "feature-0002" }),                   // used
    ];
    const items = [I({ id: "item-0001", feature_id: "feature-0002" })];
    const d = checkDrift(features, items);
    expect(d.feature_unused).toEqual([
      { feature_id: "feature-0001", title: "F" },
    ]);
  });

  it("does NOT flag dropped features as unused", () => {
    const features = [F({ id: "feature-0001", lifecycle: "dropped" })];
    expect(checkDrift(features, []).feature_unused).toEqual([]);
  });

  it("ignores dropped items when computing 'unused' active features", () => {
    const features = [F({ id: "feature-0001" })];
    const items = [I({ id: "item-0001", status: "dropped" })];
    expect(checkDrift(features, items).feature_unused).toEqual([
      { feature_id: "feature-0001", title: "F" },
    ]);
  });

  it("aggregates total across all drift kinds", () => {
    const features = [
      F({ id: "feature-0001" }),                                 // unused
      F({ id: "feature-0002", lifecycle: "dropped", superseded_by: "feature-9999" }), // dangling supersede
    ];
    const items = [
      I({ id: "item-0001", feature_id: "feature-9999" }),        // missing
      I({ id: "item-0002", feature_id: "feature-0002" }),        // pointing at dropped
    ];
    const d = checkDrift(features, items);
    expect(d.total).toBe(4);
  });
});
