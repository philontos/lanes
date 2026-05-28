// Compose a structured request for the forge spec phase from a backlog item +
// its feature + project-level context. The output is the string written into
// state.json's `request` field; the spec phase reads it as the cycle's intent.
//
// Why a structured composer (vs. just "use the item title as request"): the
// existing free-text flow asks the user to write a self-contained prompt. From
// the platform, the platform owns the context — feature membership, acceptance,
// project goal/scope, tech foundation — and assembles a richer prompt so the
// spec phase doesn't have to re-derive these from scratch.

import {
  readBacklog, readFeatures, readSpec, readPlan,
  type ProjectFeature, type ProjectItem,
} from "./state.js";

export interface SynthesizeInputs {
  item: ProjectItem;
  feature: ProjectFeature | null;
  spec: string;
  plan: string;
}

// Load everything needed for a given item ID and compose the request string.
// Throws if the item is missing or dropped (dropped items must not be runnable).
// Missing spec/plan files degrade gracefully — the cycle still runs, just with
// less context — because a newly-bootstrapped project may have empty docs.
export function synthesizeRequest(repoRoot: string, itemId: string): string {
  const backlog = readBacklog(repoRoot);
  const item = backlog.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`item ${itemId} not found in backlog.json`);
  if (item.status === "dropped") throw new Error(`item ${itemId} is dropped — cannot run`);

  const features = readFeatures(repoRoot);
  const feature = features.features.find((f) => f.id === item.feature_id) ?? null;

  const safeRead = (fn: () => string): string => { try { return fn(); } catch { return ""; } };
  const spec = safeRead(() => readSpec(repoRoot));
  const plan = safeRead(() => readPlan(repoRoot));

  return composeRequest({ item, feature, spec, plan });
}

// Pure composition — kept separate so it's directly testable without filesystem.
export function composeRequest(parts: SynthesizeInputs): string {
  const lines: string[] = [];
  lines.push(`Item: ${parts.item.title}`);

  if (parts.item.acceptance.length) {
    lines.push("");
    lines.push("Acceptance criteria:");
    for (const a of parts.item.acceptance) lines.push(`- ${a}`);
  }

  if (parts.feature) {
    lines.push("");
    lines.push(`Belongs to feature ${parts.feature.id} — ${parts.feature.title}`);
    if (parts.feature.why) lines.push(`Why this feature exists: ${parts.feature.why}`);
    if (parts.feature.design_notes.trim()) {
      lines.push("");
      lines.push("Per-feature design notes:");
      lines.push(parts.feature.design_notes.trim());
    }
  }

  const goal = extractSpecSection(parts.spec, "Goal");
  if (goal && !isPlaceholder(goal)) {
    lines.push("");
    lines.push("=== Project goal (from .lanes/spec.md) ===");
    lines.push(goal);
  }

  const scopeIn = extractSpecSection(parts.spec, "Scope IN");
  const scopeOut = extractSpecSection(parts.spec, "Scope OUT");
  if ((scopeIn && !isPlaceholder(scopeIn)) || (scopeOut && !isPlaceholder(scopeOut))) {
    lines.push("");
    lines.push("=== Project scope (from .lanes/spec.md) ===");
    if (scopeIn && !isPlaceholder(scopeIn)) { lines.push("IN:"); lines.push(scopeIn); }
    if (scopeOut && !isPlaceholder(scopeOut)) { lines.push("OUT:"); lines.push(scopeOut); }
  }

  const planTrimmed = parts.plan.trim();
  // Skip the post-init placeholder (just "(TBD — ...)" body); include real content.
  if (planTrimmed && !planTrimmed.includes("(TBD")) {
    lines.push("");
    lines.push("=== Project tech foundation (from .lanes/plan.md) ===");
    lines.push(planTrimmed);
  }

  lines.push("");
  lines.push("Complete this item per the acceptance criteria above, staying within the broader project scope.");

  return lines.join("\n");
}

// Extract the body of a specific ## H2 section from spec.md.
// Returns the prose between this heading and the next ## heading, trimmed.
// Returns "" if the section is absent.
export function extractSpecSection(specMd: string, sectionName: string): string {
  const re = new RegExp(`^##\\s+${escapeRegExp(sectionName)}\\s*$`, "m");
  const m = re.exec(specMd);
  if (!m) return "";
  const start = m.index + m[0].length;
  const rest = specMd.slice(start);
  const next = /\n##\s+/.exec(rest);
  const body = next ? rest.slice(0, next.index) : rest;
  return body.trim();
}

// Recognise post-init placeholders so we don't pad the synthesized request with
// "(none yet)" noise; we'd rather drop the section than mislead the spec phase.
function isPlaceholder(body: string): boolean {
  const stripped = body.trim();
  return stripped === "" ||
    stripped === "(none yet)" ||
    stripped === "- (none yet)" ||
    /^\(none yet\)?$/i.test(stripped) ||
    /^\(TBD/i.test(stripped);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
