import { describe, it, expect } from "vitest";
import { buildPhasePrompt } from "../src/prompts.js";

const config = {
  phases: {
    spec:   { model: "opus",   skill: "superpowers:brainstorming" },
    plan:   { model: "opus",   skill: "superpowers:writing-plans" },
    impl:   { model: "sonnet", skills: ["superpowers:executing-plans", "superpowers:test-driven-development", "superpowers:verification-before-completion"] },
    review: { model: "opus",   skill: null },
  },
};
const base = { config, request: "add a /healthz endpoint", agentsMd: "" };

describe("buildPhasePrompt", () => {
  it("spec: names brainstorming, embeds request, targets spec.md", () => {
    const p = buildPhasePrompt("spec", base);
    expect(p).toContain("superpowers:brainstorming");
    expect(p).toContain("add a /healthz endpoint");
    expect(p).toContain(".lane/spec.md");
  });
  it("plan: names writing-plans, reads spec.md, writes plan.md", () => {
    const p = buildPhasePrompt("plan", base);
    expect(p).toContain("superpowers:writing-plans");
    expect(p).toContain(".lane/spec.md");
    expect(p).toContain(".lane/plan.md");
  });
  it("impl: names executing-plans and allows Bash for code changes", () => {
    const p = buildPhasePrompt("impl", base);
    expect(p).toContain("superpowers:executing-plans");
    expect(p).toContain("Bash");
  });
  it("review: independent review (no skill), writes review.md + verdict.json", () => {
    const p = buildPhasePrompt("review", base);
    expect(p).toContain("independent review");
    expect(p).toContain(".lane/review.md");
    expect(p).toContain(".lane/verdict.json");
  });
  it("renders AGENTS.md, or (none) when empty", () => {
    expect(buildPhasePrompt("spec", base)).toContain("(none)");
    expect(buildPhasePrompt("spec", { ...base, agentsMd: "keep it tiny" })).toContain("keep it tiny");
  });
  it("is English (no CJK characters)", () => {
    expect(/[一-鿿]/.test(buildPhasePrompt("impl", base))).toBe(false);
  });
  it("scopes artifact paths to the injected lane dir", () => {
    const p = buildPhasePrompt("plan", { ...base, laneRel: ".lane/cycles/c1" });
    expect(p).toContain(".lane/cycles/c1/spec.md");
    expect(p).toContain(".lane/cycles/c1/plan.md");
  });
  it("pins the working directory so the agent stops inventing absolute paths", () => {
    const p = buildPhasePrompt("impl", base);
    expect(p.toLowerCase()).toContain("working directory");
    expect(p).toContain("relative");
  });
  it("review prompt embeds the engineering rubric and asks for a machine-readable verdict", () => {
    const p = buildPhasePrompt("review", { ...base, laneRel: ".lane/cycles/c1", rubric: "RULE: never weaken tests" });
    expect(p).toContain("RULE: never weaken tests");
    expect(p).toContain("verdict.json");
  });
  it("impl prompt injects the review feedback on a retry", () => {
    const p = buildPhasePrompt("impl", { ...base, reviewFeedback: ["weakened a test", "special-cased the input"] });
    expect(p.toLowerCase()).toContain("reject");
    expect(p).toContain("weakened a test");
    expect(p).toContain("special-cased the input");
  });
  it("spec produces a codebase map for downstream phases to orient from", () => {
    const p = buildPhasePrompt("spec", { ...base, laneRel: ".lane/cycles/c1" });
    expect(p).toContain(".lane/cycles/c1/codebase-map.md");
  });
  it("downstream phases read the codebase map first and are told not to re-scan", () => {
    for (const phase of ["plan", "impl", "review"]) {
      const p = buildPhasePrompt(phase, { ...base, laneRel: ".lane/cycles/c1" });
      expect(p).toContain(".lane/cycles/c1/codebase-map.md");
      expect(p.toLowerCase()).toContain("re-scan");
    }
  });
  it("does NOT tell spec to orient from a map it hasn't written yet", () => {
    const p = buildPhasePrompt("spec", { ...base, laneRel: ".lane/cycles/c1" });
    expect(p.toLowerCase()).not.toContain("re-scan");
  });
  it("impl gets the frontend-design skill + design bar, gated on UI work", () => {
    const p = buildPhasePrompt("impl", { ...base, designPrinciples: "BAR: restrained palette" });
    expect(p).toContain("frontend-design");
    expect(p).toContain("BAR: restrained palette");
    expect(p.toLowerCase()).toContain("ui");
  });
  it("spec records the aesthetic direction per the design bar", () => {
    const p = buildPhasePrompt("spec", { ...base, designPrinciples: "BAR: restrained palette" });
    expect(p).toContain("BAR: restrained palette");
  });
  it("does not inject the design bar into plan or review", () => {
    for (const phase of ["plan", "review"]) {
      expect(buildPhasePrompt(phase, { ...base, designPrinciples: "BAR: nope" })).not.toContain("BAR: nope");
    }
  });
});
