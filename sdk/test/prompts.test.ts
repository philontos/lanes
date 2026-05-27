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
  it("review: built-in self-review (no skill), writes review.md", () => {
    const p = buildPhasePrompt("review", base);
    expect(p).toContain("self-review");
    expect(p).toContain(".lane/review.md");
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
});
