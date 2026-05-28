// Status derivation: feature.display_status and project.display_status are
// computed on read from item.status, never stored. Storing them invites
// contradictions; this module is the single derivation site.

import type { ProjectFeature, ProjectItem } from "./state.js";

export type DisplayStatus = "todo" | "in-progress" | "done" | "blocked" | "dropped";

// Order of checks matches the spec's Derived status block:
//   feature.lifecycle == dropped         -> dropped
//   no non-dropped items                 -> todo
//   all items done                       -> done
//   any item in-progress                 -> in-progress  (takes precedence over blocked)
//   any item blocked                     -> blocked
//   otherwise                            -> todo
export function featureDisplayStatus(feature: ProjectFeature, items: ProjectItem[]): DisplayStatus {
  if (feature.lifecycle === "dropped") return "dropped";
  const own = items.filter((i) => i.feature_id === feature.id && i.status !== "dropped");
  if (own.length === 0) return "todo";
  if (own.every((i) => i.status === "done")) return "done";
  if (own.some((i) => i.status === "in-progress")) return "in-progress";
  if (own.some((i) => i.status === "blocked")) return "blocked";
  return "todo";
}

// Project status aggregates the active features the same way.
export function projectDisplayStatus(features: ProjectFeature[], items: ProjectItem[]): DisplayStatus {
  const active = features.filter((f) => f.lifecycle !== "dropped");
  if (active.length === 0) return "todo";
  const statuses = active.map((f) => featureDisplayStatus(f, items));
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.some((s) => s === "in-progress")) return "in-progress";
  if (statuses.some((s) => s === "blocked")) return "blocked";
  return "todo";
}
