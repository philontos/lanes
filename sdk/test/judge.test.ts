import { describe, it, expect } from "vitest";
import { buildJudgePrompt, parseAnswers, judge, type AskQuestion } from "../src/judge.js";

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
  it("does not crash when a question carries no options", () => {
    const empty: AskQuestion[] = [{ question: "Q?", header: "q", options: [], multiSelect: false }];
    expect(parseAnswers('{"answers":{}}', empty)["Q?"]).toBe("");
  });
});

describe("judge resilience", () => {
  it("returns parsed answers, not degraded, when the ask succeeds", async () => {
    const ask = async () => '{"answers":{"Use a new dependency or stdlib?":"new dep"}}';
    const res = await judge(qs, "p", ask);
    expect(res.degraded).toBe(false);
    expect(res.answers["Use a new dependency or stdlib?"]).toBe("new dep");
  });
  it("retries the ask once, then falls back to safe defaults flagged degraded", async () => {
    let calls = 0;
    const ask = async () => { calls++; throw new Error("network"); };
    const res = await judge(qs, "p", ask);
    expect(calls).toBe(2); // initial + 1 retry — never crashes the phase over a popup
    expect(res.degraded).toBe(true);
    expect(res.answers["Use a new dependency or stdlib?"]).toBe("stdlib"); // safe default = first option
  });
});
