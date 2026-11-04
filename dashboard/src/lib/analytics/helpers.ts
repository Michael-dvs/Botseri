import { addDays, format } from "date-fns";
import { z } from "zod";
import { localDateString, localDateTimeToUtc } from "@/lib/time";

export type StatRowInput = {
  target_count: number;
  done_count: number;
  completion_rate: number | null;
};

export type StatSummary = {
  total_target: number;
  total_done: number;
  average_rate: number | null;
};

const daysSchema = z
  .string()
  .regex(/^\d+$/, "days harus bilangan bulat positif")
  .transform((val) => Number.parseInt(val, 10))
  .pipe(z.number().int().min(1, "days minimal 1").max(365, "days maksimal 365"));

export function parseDaysParam(
  value: string | null | undefined,
): { ok: true; days: number } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, days: 30 };
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false, error: "days harus bilangan bulat antara 1 dan 365" };
  }

  const result = daysSchema.safeParse(trimmed);
  if (!result.success) {
    return { ok: false, error: "days harus bilangan bulat antara 1 dan 365" };
  }

  return { ok: true, days: result.data };
}

export function summarizeStats(rows: StatRowInput[]): StatSummary {
  const total_target = rows.reduce((sum, r) => sum + r.target_count, 0);
  const total_done = rows.reduce((sum, r) => sum + r.done_count, 0);

  const withRate = rows.filter(
    (r): r is StatRowInput & { completion_rate: number } =>
      r.completion_rate !== null && Number.isFinite(r.completion_rate),
  );

  const average_rate =
    withRate.length > 0
      ? withRate.reduce((sum, r) => sum + r.completion_rate, 0) / withRate.length
      : null;

  return {
    total_target,
    total_done,
    average_rate,
  };
}

export function safeBigInt(val: bigint | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}
export function safeDecimal(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number(val);
  if (val && typeof val === "object" && "toNumber" in val) {
    const fn = val.toNumber;
    if (typeof fn === "function") {
      return Number(fn.call(val));
    }
  }
  return Number(val);
}

export function getSchedulerStaleMinutes(): number {
  const envVal = Number(process.env.SCHEDULER_STALE_MINUTES);
  if (Number.isFinite(envVal) && envVal > 0) {
    return Math.floor(envVal);
  }
  return 3;
}

export function tickHealth(
  now: Date,
  lastTickAt: Date | null | undefined,
  staleMinutes: number = getSchedulerStaleMinutes(),
): "OK" | "STALE" | "NEVER" {
  if (!lastTickAt) return "NEVER";
  const diff = now.getTime() - lastTickAt.getTime();
  if (diff < 0) return "OK";
  if (diff <= staleMinutes * 60 * 1000) return "OK";
  return "STALE";
}

export function maskChatId(chatId: string): string {
  if (!chatId) return "";
  if (chatId.length <= 4) return chatId;
  const visible = chatId.slice(-4);
  const masked = "*".repeat(chatId.length - 4);
  return `${masked}${visible}`;
}

export function truncateMessage(
  text: string | null | undefined,
  maxLen = 120,
): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

export function usageDateCutoff(
  now: Date,
  timezone: string,
  days: number,
): Date {
  const todayStr = localDateString(now, timezone);
  const anchor = new Date(`${todayStr}T00:00:00Z`);
  const earliestDate = addDays(anchor, -(days - 1));
  const earliestDateStr = format(earliestDate, "yyyy-MM-dd");
  return localDateTimeToUtc(earliestDateStr, timezone, "00:00:00");
}
