import { describe, expect, it } from "vitest";
import { computeDailyStats } from "@/lib/stats";

describe("computeDailyStats", () => {
  it("mengembalikan NO_TASKS untuk target nol atau negatif", () => {
    expect(computeDailyStats(0, 0)).toMatchObject({ tier: "NO_TASKS", completion_rate: null });
    expect(computeDailyStats(-1, 0)).toMatchObject({ tier: "NO_TASKS", completion_rate: null });
  });

  it.each([
    [10000, 3999, "LOW"],
    [10, 4, "MID"],
    [10000, 6999, "MID"],
    [10, 7, "HIGH"],
    [10, 10, "HIGH"],
    [10, 0, "LOW"],
  ] as const)("menetapkan tier untuk %i/%i", (target, done, tier) => {
    expect(computeDailyStats(target, done).tier).toBe(tier);
  });

  it("tidak membulatkan persentase", () => {
    expect(computeDailyStats(3, 1).completion_rate).toBeCloseTo(33.33333333333333, 12);
  });

  it.each([
    [Number.NaN, 0],
    [1.5, 1],
    [1, 1.5],
    [1, -1],
    [1, 2],
    [0, 1],
  ])("menolak input tidak valid %s/%s", (target, done) => {
    expect(() => computeDailyStats(target, done)).toThrow();
  });
});
