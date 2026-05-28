import { describe, it, expect } from "vitest";
import { nextId, parseId } from "../src/project/ids.js";

describe("nextId", () => {
  it("pads to 4 digits and increments seq", () => {
    expect(nextId("feature", 1)).toEqual({ id: "feature-0001", nextSeq: 2 });
    expect(nextId("item", 42)).toEqual({ id: "item-0042", nextSeq: 43 });
  });

  it("does not truncate past 4 digits — long-lived projects can cross 9999", () => {
    expect(nextId("item", 10000)).toEqual({ id: "item-10000", nextSeq: 10001 });
  });
});

describe("parseId", () => {
  it("parses well-formed IDs", () => {
    expect(parseId("feature-0001")).toEqual({ prefix: "feature", seq: 1 });
    expect(parseId("item-9999")).toEqual({ prefix: "item", seq: 9999 });
    expect(parseId("item-10000")).toEqual({ prefix: "item", seq: 10000 });
  });

  it("returns null on malformed IDs", () => {
    expect(parseId("foo")).toBeNull();
    expect(parseId("feature-1")).toBeNull();        // too few digits
    expect(parseId("Feature-0001")).toBeNull();     // wrong case
    expect(parseId("epic-0001")).toBeNull();        // unknown prefix
    expect(parseId("")).toBeNull();
  });
});
