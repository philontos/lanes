import { describe, it, expect } from "vitest";
import { mergeModelUsage, formatUsageReport } from "../src/usage.js";

const phaseA = {
  "claude-opus-4-7": { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 200, costUSD: 0.1 },
};
const phaseB = {
  "claude-opus-4-7": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 20, costUSD: 0.02 },
  "claude-sonnet-4-6": { inputTokens: 500, outputTokens: 300, cacheReadInputTokens: 2000, cacheCreationInputTokens: 50, costUSD: 0.05 },
};

describe("mergeModelUsage", () => {
  it("accumulates a single phase into an empty accumulator", () => {
    const acc = mergeModelUsage({}, phaseA);
    expect(acc["claude-opus-4-7"]).toEqual({
      inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 200, costUSD: 0.1,
    });
  });

  it("sums usage for the same model across phases", () => {
    let acc = mergeModelUsage({}, phaseA);
    acc = mergeModelUsage(acc, phaseB);
    const u = acc["claude-opus-4-7"];
    expect(u.inputTokens).toBe(110);
    expect(u.outputTokens).toBe(55);
    expect(u.cacheReadInputTokens).toBe(1100);
    expect(u.cacheCreationInputTokens).toBe(220);
    expect(u.costUSD).toBeCloseTo(0.12, 5);
  });

  it("keeps distinct models separate", () => {
    let acc = mergeModelUsage({}, phaseA);
    acc = mergeModelUsage(acc, phaseB);
    expect(Object.keys(acc).sort()).toEqual(["claude-opus-4-7", "claude-sonnet-4-6"]);
    expect(acc["claude-sonnet-4-6"].inputTokens).toBe(500);
  });

  it("does not mutate the accumulator passed in", () => {
    const acc0 = {};
    const acc1 = mergeModelUsage(acc0, phaseA);
    expect(acc0).toEqual({});
    expect(acc1).not.toBe(acc0);
  });

  it("returns an unchanged accumulator when a phase reports no usage", () => {
    const acc = mergeModelUsage({}, phaseA);
    expect(mergeModelUsage(acc, undefined)).toEqual(acc);
    expect(mergeModelUsage(acc, null)).toEqual(acc);
  });
});

describe("formatUsageReport", () => {
  it("renders a row per model with summed tokens and a total row", () => {
    let acc = mergeModelUsage({}, phaseA);
    acc = mergeModelUsage(acc, phaseB);
    const report = formatUsageReport(acc);
    expect(report).toContain("TOKEN USAGE");
    expect(report).toContain("claude-opus-4-7");
    expect(report).toContain("claude-sonnet-4-6");
    expect(report).toMatch(/total/i);
    // total input tokens = 110 (opus) + 500 (sonnet) = 610
    expect(report).toContain("610");
  });

  it("handles an empty accumulator without throwing", () => {
    expect(formatUsageReport({})).toContain("TOKEN USAGE");
  });
});
