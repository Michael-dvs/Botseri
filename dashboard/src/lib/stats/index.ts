import type { EvalTier } from "@prisma/client";

export type DailyStats = {
  target_count: number;
  done_count: number;
  pending_count: number;
  completion_rate: number | null;
  tier: EvalTier;
};

export function computeDailyStats(target: number, done: number): DailyStats {
  if (!Number.isFinite(target) || !Number.isInteger(target)) {
    throw new TypeError("target harus berupa bilangan bulat terbatas");
  }
  if (!Number.isFinite(done) || !Number.isInteger(done)) {
    throw new TypeError("done harus berupa bilangan bulat terbatas");
  }
  if (done < 0) throw new RangeError("done tidak boleh negatif");
  if (target <= 0) {
    if (done > 0) throw new RangeError("done tidak boleh melebihi target");
    return {
      target_count: 0,
      done_count: 0,
      pending_count: 0,
      completion_rate: null,
      tier: "NO_TASKS",
    };
  }
  if (done > target) throw new RangeError("done tidak boleh melebihi target");

  const completionRate = (done / target) * 100;
  const tier: EvalTier = completionRate >= 70 ? "HIGH" : completionRate >= 40 ? "MID" : "LOW";

  return {
    target_count: target,
    done_count: done,
    pending_count: target - done,
    completion_rate: completionRate,
    tier,
  };
}
