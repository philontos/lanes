import { describe, it, expect } from "vitest";
import { buildJudgePrompt, parseAnswers, type AskQuestion } from "../src/judge.js";

const qs: AskQuestion[] = [{
  question: "Use a new dependency or stdlib?", header: "dep",
  options: [{ label: "stdlib", description: "" }, { label: "new dep", description: "" }],
  multiSelect: false,
}];

describe("judge logic", () => {
  it("prompt includes the principles and the question", () => {
    const p = buildJudgePrompt(qs, "#4 prefer stdlib");
    expect(p).toContain("#4 prefer stdlib");
    expect(p).toContain("Use a new dependency or stdlib?");
  });
  it("parses a valid JSON answer keyed by question", () => {
    const raw = '{"answers":{"Use a new dependency or stdlib?":"stdlib"}}';
    expect(parseAnswers(raw, qs)["Use a new dependency or stdlib?"]).toBe("stdlib");
  });
  it("falls back to the first option when the model returns an invalid label", () => {
    const raw = '{"answers":{"Use a new dependency or stdlib?":"banana"}}';
    expect(parseAnswers(raw, qs)["Use a new dependency or stdlib?"]).toBe("stdlib");
  });
  it("falls back to the first option when JSON is unparseable", () => {
    expect(parseAnswers("not json", qs)["Use a new dependency or stdlib?"]).toBe("stdlib");
  });
});
