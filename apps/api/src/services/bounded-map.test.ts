import { it, expect } from "vitest";
import { mapBounded } from "./bounded-map";

it("never runs more than `limit` at once", async () => {
  let running = 0;
  let peak = 0;
  const work = async (n: number) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return n * 2;
  };

  const out = await mapBounded([1, 2, 3, 4, 5, 6, 7, 8], 3, work);

  expect(peak).toBeLessThanOrEqual(3);
  expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]); // order preserved
});

it("handles an empty input without spawning any workers", async () => {
  let calls = 0;
  const out = await mapBounded([] as number[], 3, (n: number) => {
    calls += 1;
    return Promise.resolve(n);
  });
  expect(out).toEqual([]);
  expect(calls).toBe(0);
});

it("handles fewer items than the limit", async () => {
  const out = await mapBounded([1, 2], 5, (n: number) => Promise.resolve(n * 10));
  expect(out).toEqual([10, 20]);
});

it("propagates a rejection from one item", async () => {
  await expect(
    mapBounded([1, 2, 3], 2, (n: number) => {
      if (n === 2) return Promise.reject(new Error("boom"));
      return Promise.resolve(n);
    }),
  ).rejects.toThrow("boom");
});
