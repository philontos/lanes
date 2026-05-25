import { describe, it, expect } from "vitest";
import { PHASES, resolveModel, skillsForPhase, resolveLimits } from "../src/phases.js";

const config = {
  phases: {
    spec:   { model: "opus",   skill: "superpowers:brainstorming", maxTurns: 25, maxThinkingTokens: 4000 },
    plan:   { model: "opus",   skill: "superpowers:writing-plans", maxTurns: 30, maxThinkingTokens: null },
    impl:   { model: "sonnet", skills: ["superpowers:executing-plans", "superpowers:test-driven-development", "superpowers:verification-before-completion", "superpowers:dispatching-parallel-agents"] },
    review: { model: "opus",   skill: null },
  },
};

describe("PHASES", () => {
  it("is the fixed forge chain", () => {
    expect(PHASES).toEqual(["spec", "plan", "impl", "review"]);
  });
});

describe("resolveModel", () => {
  it("returns the phase's model from config", () => {
    expect(resolveModel(config, "spec")).toBe("opus");
    expect(resolveModel(config, "impl")).toBe("sonnet");
  });
  it("falls back to sonnet for unknown phase / missing config", () => {
    expect(resolveModel(config, "mystery")).toBe("sonnet");
    expect(resolveModel({}, "spec")).toBe("sonnet");
  });
});

describe("skillsForPhase", () => {
  it("supports single `skill` and array `skills`", () => {
    expect(skillsForPhase(config, "spec")).toEqual(["superpowers:brainstorming"]);
    expect(skillsForPhase(config, "impl")).toEqual([
      "superpowers:executing-plans",
      "superpowers:test-driven-development",
      "superpowers:verification-before-completion",
      "superpowers:dispatching-parallel-agents",
    ]);
  });
  it("returns [] when skill is null/absent (e.g. review) or phase unknown", () => {
    expect(skillsForPhase(config, "review")).toEqual([]);
    expect(skillsForPhase(config, "mystery")).toEqual([]);
    expect(skillsForPhase({}, "spec")).toEqual([]);
  });
});

describe("resolveLimits", () => {
  it("returns positive limits set for the phase", () => {
    expect(resolveLimits(config, "spec")).toEqual({ maxTurns: 25, maxThinkingTokens: 4000 });
  });
  it("omits null/absent/non-positive fields", () => {
    expect(resolveLimits(config, "plan")).toEqual({ maxTurns: 30 });
    expect(resolveLimits(config, "review")).toEqual({});
    expect(resolveLimits({ phases: { spec: { maxTurns: 0 } } }, "spec")).toEqual({});
    expect(resolveLimits({}, "spec")).toEqual({});
  });
});
