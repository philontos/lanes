import { describe, it, expect } from "vitest";
import { buildPhasePrompt } from "../src/prompts.js";

const skills = {
  skills: {
    discover: "superpowers:brainstorming",
    plan: "superpowers:writing-plans",
    execute: "superpowers:executing-plans",
    tdd: "superpowers:test-driven-development",
    verify: "superpowers:verification-before-completion",
    parallel: "superpowers:dispatching-parallel-agents",
  },
  usage: { spec: ["discover"], plan: ["plan"], impl: ["execute", "tdd", "verify", "parallel"], review: [] },
};
const base = { skills, request: "add a /healthz endpoint", agentsMd: "" };

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
});
