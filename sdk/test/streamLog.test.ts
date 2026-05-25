import { describe, it, expect } from "vitest";
import { formatMessage } from "../src/streamLog.js";

describe("formatMessage", () => {
  it("renders assistant text blocks as-is", () => {
    const m = { type: "assistant", message: { content: [{ type: "text", text: "正在写 spec" }] } };
    expect(formatMessage(m)).toEqual(["正在写 spec"]);
  });

  it("renders a tool_use block as an arrow line with truncated json args", () => {
    const m = { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/y.ts" } }] } };
    expect(formatMessage(m)).toEqual([`→ Read({"file_path":"/x/y.ts"})`]);
  });

  it("emits one line per block when text and tool_use coexist", () => {
    const m = { type: "assistant", message: { content: [
      { type: "text", text: "先读文件" },
      { type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } },
    ] } };
    expect(formatMessage(m)).toEqual(["先读文件", `→ Glob({"pattern":"**/*.ts"})`]);
  });

  it("renders a string tool_result truncated to one line", () => {
    const long = "a".repeat(250);
    const m = { type: "user", message: { content: [{ type: "tool_result", content: long }] } };
    const out = formatMessage(m);
    expect(out).toHaveLength(1);
    expect(out[0].startsWith("  ⤷ ")).toBe(true);
    expect(out[0].length).toBeLessThanOrEqual(4 + 200 + 1); // prefix + 200 chars + ellipsis
    expect(out[0].endsWith("…")).toBe(true);
  });

  it("collapses newlines in tool_result content to a single line", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: "line1\n\nline2" }] } };
    expect(formatMessage(m)).toEqual(["  ⤷ line1 line2"]);
  });

  it("flattens array tool_result content (text blocks) before truncating", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "hello" }] }] } };
    expect(formatMessage(m)).toEqual(["  ⤷ hello"]);
  });

  it("returns [] for result messages (run.ts prints the final line)", () => {
    expect(formatMessage({ type: "result", subtype: "success", result: "done" })).toEqual([]);
  });

  it("returns [] for unknown/malformed messages", () => {
    expect(formatMessage({ type: "system" })).toEqual([]);
    expect(formatMessage(null)).toEqual([]);
    expect(formatMessage({ type: "assistant", message: {} })).toEqual([]);
  });
});
