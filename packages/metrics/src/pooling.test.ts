import { describe, expect, it } from "vitest";
import { POOLING, poolingKind } from "./pooling.js";
import { loadSpecs } from "./spec.js";

describe("portfolio pooling declarations (ADR-0015)", () => {
  it("DM-P2: the pooling enumeration covers exactly the governed dictionary — a new metric must declare its portfolio behavior", () => {
    expect(Object.keys(POOLING).sort()).toEqual(
      loadSpecs()
        .map((l) => l.spec.id)
        .sort(),
    );
  });

  it("an undeclared metric is a hard error, never a silently unpooled card", () => {
    expect(() => poolingKind("no_such_metric")).toThrow(/no pooling kind declared/);
  });
});
