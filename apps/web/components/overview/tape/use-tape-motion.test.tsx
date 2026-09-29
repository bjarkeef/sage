import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTapeMotion } from "./use-tape-motion";

const extent = { firstDay: 0, lastDay: 2000 };
const W = 1096;

describe("useTapeMotion with motion off", () => {
  it("jumps straight to a target and tells subscribers", () => {
    const { result } = renderHook(() =>
      useTapeMotion(W, extent, false, { leftDay: 100, pxPerDay: 2 }),
    );
    const seen: number[] = [];
    act(() => void result.current.onFrame((v) => seen.push(v.leftDay)));
    act(() => result.current.setTarget({ leftDay: 500, pxPerDay: 2 }));
    expect(result.current.view.leftDay).toBe(500);
    expect(result.current.viewRef.current.leftDay).toBe(500);
    expect(seen).toEqual([500]);
  });

  it("clamps a pan at the end of the history", () => {
    const { result } = renderHook(() =>
      useTapeMotion(W, extent, false, { leftDay: 100, pxPerDay: 2 }),
    );
    act(() => result.current.panBy(-10_000, true));
    expect(result.current.view.leftDay).toBeCloseTo(-24);
  });

  it("ignores a fling", () => {
    const { result } = renderHook(() =>
      useTapeMotion(W, extent, false, { leftDay: 100, pxPerDay: 2 }),
    );
    act(() => result.current.fling(5));
    expect(result.current.view.leftDay).toBe(100);
  });
});
