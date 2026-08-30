import { describe, it, expect } from "vitest";
import { resolvePath, pathOf } from "./category-path";
import type { CategoryNodeDTO } from "./types";

const money = { amount: "0.00", currency: "DKK" };

function node(id: string, children: CategoryNodeDTO[] = []): CategoryNodeDTO {
  return {
    id,
    name: id,
    targetPct: null,
    actualPct: 0,
    value: money,
    invested: money,
    gain: money,
    gainPercent: null,
    children,
    holdings: [],
    itemCount: children.length,
  };
}

const root = node("root", [node("a", [node("b", [node("c")])]), node("x")]);

describe("resolvePath", () => {
  it("returns the root for an empty path", () => {
    const r = resolvePath(root, null);
    expect(r.node.id).toBe("root");
    expect(r.trail).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("walks a full path down the tree", () => {
    const r = resolvePath(root, "a/b/c");
    expect(r.node.id).toBe("c");
    expect(r.trail.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(r.truncated).toBe(false);
  });

  it("stops at the deepest node it can reach and says so", () => {
    const r = resolvePath(root, "a/gone/c");
    expect(r.node.id).toBe("a");
    expect(r.trail.map((n) => n.id)).toEqual(["a"]);
    expect(r.truncated).toBe(true);
  });

  it("does not treat a sibling elsewhere in the tree as a match", () => {
    // "x" is a child of the root, not of "a" — a path must be a real descent.
    const r = resolvePath(root, "a/x");
    expect(r.node.id).toBe("a");
    expect(r.truncated).toBe(true);
  });

  it("round-trips a trail through pathOf", () => {
    const r = resolvePath(root, "a/b");
    expect(pathOf(r.trail)).toBe("a/b");
    expect(pathOf([])).toBe("");
  });
});
