import { describe, it, expect } from "vitest";
import { resolveModel } from "../src/phases.js";
import { PHASES, skillsForPhase } from "../src/phases.js";

const skillsMap = {
  skills: {
    discover: "superpowers:brainstorming",
    plan: "superpowers:writing-plans",
    execute: "superpowers:executing-plans",
    tdd: "superpowers:test-driven-development",
    verify: "superpowers:verification-before-completion",
    parallel: "superpowers:dispatching-parallel-agents",
  },
  usage: {
    spec: ["discover"],
    plan: ["plan"],
    impl: ["execute", "tdd", "verify", "parallel"],
    review: [],
  },
};

describe("PHASES", () => {
  it("is the fixed forge chain for this cut", () => {
    expect(PHASES).toEqual(["spec", "plan", "impl", "review"]);
  });
});

describe("skillsForPhase", () => {
  it("resolves usage roles to concrete skill names", () => {
    expect(skillsForPhase(skillsMap, "spec")).toEqual(["superpowers:brainstorming"]);
    expect(skillsForPhase(skillsMap, "plan")).toEqual(["superpowers:writing-plans"]);
    expect(skillsForPhase(skillsMap, "impl")).toEqual([
      "superpowers:executing-plans",
      "superpowers:test-driven-development",
      "superpowers:verification-before-completion",
      "superpowers:dispatching-parallel-agents",
    ]);
  });
  it("returns [] for a phase with no usage roles (e.g. review)", () => {
    expect(skillsForPhase(skillsMap, "review")).toEqual([]);
  });
  it("returns [] for an unknown phase or missing maps", () => {
    expect(skillsForPhase(skillsMap, "mystery")).toEqual([]);
    expect(skillsForPhase({}, "spec")).toEqual([]);
  });
});

const skills = { models: { spec: { subagent: "opus" }, impl: { subagent: "sonnet" } } };
describe("resolveModel", () => {
  it("returns the phase's model-family alias from skills.json", () => {
    expect(resolveModel(skills, "spec")).toBe("opus");
    expect(resolveModel(skills, "impl")).toBe("sonnet");
  });
  it("falls back to sonnet for unknown phase", () => {
    expect(resolveModel(skills, "mystery")).toBe("sonnet");
  });
});
