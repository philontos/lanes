// Static drift checks against a project's features.json + backlog.json. Pure
// functions over already-loaded state; no I/O. Cheap to run on every Pulse fetch.
//
// What "drift" means here: structural inconsistencies the human can fix in
// minutes if they're surfaced, and that will silently rot the model if they
// aren't. We deliberately keep this static (no LLM-assisted scan against code)
// — that's a separate, more expensive class of check.

import type { ProjectFeature, ProjectItem } from "../../sdk/src/project/state.js";

export interface DriftItemFeatureMissing {
  item_id: string;
  feature_id: string;        // references a feature_id that doesn't exist
  title: string;
}
export interface DriftItemFeatureDropped {
  item_id: string;
  feature_id: string;        // references a feature that's lifecycle="dropped"
  title: string;
}
export interface DriftFeatureSupersededDangling {
  feature_id: string;
  superseded_by: string;     // points at a non-existent feature
}
export interface DriftFeatureUnused {
  feature_id: string;        // lifecycle=active but zero non-dropped items reference it
  title: string;
}

export interface DriftReport {
  item_feature_missing: DriftItemFeatureMissing[];
  item_feature_dropped: DriftItemFeatureDropped[];
  feature_superseded_dangling: DriftFeatureSupersededDangling[];
  feature_unused: DriftFeatureUnused[];
  // Total count for quick "are there any?" checks
  total: number;
}

export function checkDrift(features: ProjectFeature[], items: ProjectItem[]): DriftReport {
  const featureById = new Map(features.map((f) => [f.id, f] as const));

  const item_feature_missing: DriftItemFeatureMissing[] = [];
  const item_feature_dropped: DriftItemFeatureDropped[] = [];

  // Only consider non-dropped items — dropped items are tombstones, their feature
  // references are intentionally allowed to dangle.
  for (const i of items) {
    if (i.status === "dropped") continue;
    const f = featureById.get(i.feature_id);
    if (!f) {
      item_feature_missing.push({ item_id: i.id, feature_id: i.feature_id, title: i.title });
    } else if (f.lifecycle === "dropped") {
      item_feature_dropped.push({ item_id: i.id, feature_id: i.feature_id, title: i.title });
    }
  }

  const feature_superseded_dangling: DriftFeatureSupersededDangling[] = [];
  for (const f of features) {
    if (f.superseded_by && !featureById.has(f.superseded_by)) {
      feature_superseded_dangling.push({ feature_id: f.id, superseded_by: f.superseded_by });
    }
  }

  // "Unused active feature" = a feature marked active but with no non-dropped items
  // pointing at it. Could be intentional (capability that exists but has no pending
  // work) — so this is a soft signal, not a hard error. We still report it so the
  // user can decide.
  const usedFeatureIds = new Set(
    items.filter((i) => i.status !== "dropped").map((i) => i.feature_id),
  );
  const feature_unused: DriftFeatureUnused[] = [];
  for (const f of features) {
    if (f.lifecycle === "active" && !usedFeatureIds.has(f.id)) {
      feature_unused.push({ feature_id: f.id, title: f.title });
    }
  }

  return {
    item_feature_missing,
    item_feature_dropped,
    feature_superseded_dangling,
    feature_unused,
    total: item_feature_missing.length
         + item_feature_dropped.length
         + feature_superseded_dangling.length
         + feature_unused.length,
  };
}
