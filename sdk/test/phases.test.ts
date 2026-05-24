import { describe, it, expect } from "vitest";
import { resolveModel } from "../src/phases.js";

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
