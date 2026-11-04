import { addDays, format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function localTimeString(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "HH:mm");
}

export function localDateString(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export function dateOnlyString(date: Date) {
  return formatInTimeZone(date, "UTC", "yyyy-MM-dd");
}

export function dateOnlyToDate(date: string) {
  return fromZonedTime(`${date}T00:00:00`, "UTC");
}

export function isoWeekday(date: Date, timezone: string) {
  return Number(formatInTimeZone(date, timezone, "i"));
}

export function isWorkingDay(
  date: Date,
  timezone: string,
  days: number[],
  holidays: string[] = [],
) {
  const localDate = localDateString(date, timezone);
  return days.includes(isoWeekday(date, timezone)) && !holidays.includes(localDate);
}

export function nextWorkingDay(
  date: Date,
  timezone: string,
  days: number[],
  holidays: string[] = [],
) {
  const local = localDateString(date, timezone);
  const anchor = new Date(`${local}T00:00:00Z`);
  for (let i = 1; i <= 366; i++) {
    const candidate = addDays(anchor, i);
    const candidateDate = dateOnlyString(candidate);
    if (days.includes(candidate.getUTCDay() || 7) && !holidays.includes(candidateDate)) {
      return candidateDate;
    }
  }
  throw new Error("hari kerja berikutnya tidak ditemukan dalam 366 hari");
}

export function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function inWindow(
  now: Date,
  timezone: string,
  start: string,
  minutes: number,
) {
  const current = minutesOfDay(localTimeString(now, timezone));
  return current >= minutesOfDay(start) && current < minutesOfDay(start) + minutes;
}

export function localDateTimeToUtc(
  date: string,
  timezone: string,
  time = "00:00:00",
) {
  return fromZonedTime(`${date}T${time}`, timezone);
}

export function localDayUtcBounds(date: Date, timezone: string) {
  const localDate = localDateString(date, timezone);
  const nextDate = dateOnlyString(addDays(new Date(`${localDate}T00:00:00Z`), 1));
  return {
    start: localDateTimeToUtc(localDate, timezone),
    end: localDateTimeToUtc(nextDate, timezone),
  };
}

export function dateFromLocalNoon(date: string, timezone: string) {
  return fromZonedTime(`${date}T12:00:00`, timezone);
}

export function localIsoString(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export function formatLocalDateTime(date: Date | string, timezone: string) {
  return formatInTimeZone(new Date(date), timezone, "d MMM yyyy, HH:mm", {
    locale: localeId,
  });
}

export function formatLocalDate(date: Date | string, timezone: string) {
  return formatInTimeZone(new Date(date), timezone, "d MMM yyyy", {
    locale: localeId,
  });
}

export function localDateTimeInputToUtc(value: string, timezone: string) {
  return fromZonedTime(value, timezone);
}

export function lastNDays(
  now: Date,
  timezone: string,
  n: number,
): string[] {
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const anchor = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    addDays(anchor, -(n - 1 - i)).toISOString().slice(0, 10),
  );
}

export function dateOnly(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/**
 * Normalizes an arbitrary ISO datetime, naive datetime, or date-only string
 * into a strict ISO-8601 string with explicit timezone offset (e.g. 2026-10-23T10:00:00+07:00).
 * If naive date/time is received, interprets it in the given timezone (default Asia/Jakarta).
 */
export function normalizeIsoDateTime(
  val: string | null | undefined,
  timezone: string = "Asia/Jakarta",
): string | null {
  if (!val) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;

  // 1. Date-only: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const utcDate = fromZonedTime(`${trimmed}T00:00:00`, timezone);
    return localIsoString(utcDate, timezone);
  }

  // 2. Naive datetime without offset: YYYY-MM-DDTHH:mm(:ss)? or YYYY-MM-DD HH:mm(:ss)?
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(trimmed)) {
    const standardized = trimmed.replace(" ", "T");
    const withSeconds = standardized.length === 16 ? `${standardized}:00` : standardized;
    const utcDate = fromZonedTime(withSeconds, timezone);
    return localIsoString(utcDate, timezone);
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Format tanggal/waktu tidak valid: '${trimmed}'`);
  }
  return localIsoString(parsed, timezone);
}

export type DaypartType = "PAGI" | "SIANG" | "SORE" | "MALAM";

export const MIN_FUTURE_MARGIN_MINUTES = 1;

export const DAYPART_SLOTS = {
  PAGI_TODAY: "08:30",
  PAGI_TOMORROW: "08:00",
  SIANG: "12:30",
  SORE: "16:00",
  MALAM: "19:30",
} as const;

export type TimeExpressionInput = {
  kind?: "CLOCK" | "DAYPART" | string | null;
  time_kind?: "CLOCK" | "DAYPART" | string | null;
  hour?: number | string | null;
  minute?: number | string | null;
  period?: DaypartType | string | null;
  half_before?: boolean | string | null;
  daypart?: DaypartType | string | null;
  date_hint?: "TODAY" | "TOMORROW" | string | null;
};

export type TimeResolutionResult =
  | {
      ok: true;
      due_at: Date;
      due_at_iso: string;
      due_at_local_text: string;
      planned_date: Date;
      planned_date_string: string;
      has_specific_time: true;
      is_rollover_tomorrow: boolean;
    }
  | {
      ok: false;
      error: "PAST_TIME_WITH_EXPLICIT_DATE" | "INVALID_TIME_EXPRESSION";
      message: string;
    };

export function formatDueAtLocalText(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "EEEE, d MMM yyyy, HH:mm 'WIB'", {
    locale: localeId,
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function resolveTimeExpression(
  now: Date,
  timezone: string,
  expr: TimeExpressionInput,
  dateHintParam?: string | null,
): TimeResolutionResult {
  const todayDateStr = localDateString(now, timezone);
  const anchorToday = new Date(`${todayDateStr}T00:00:00Z`);
  const tomorrowDateStr = format(addDays(anchorToday, 1), "yyyy-MM-dd");

  const rawHint = (dateHintParam || expr.date_hint || "").trim().toUpperCase();
  let explicitDate: string | null = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawHint)) {
    explicitDate = rawHint;
  } else if (rawHint === "TODAY") {
    explicitDate = todayDateStr;
  } else if (rawHint === "TOMORROW") {
    explicitDate = tomorrowDateStr;
  }

  const kind = (expr.kind || expr.time_kind || "").toUpperCase();
  const isClock = kind === "CLOCK" || expr.hour !== undefined && expr.hour !== null;
  const isDaypart = kind === "DAYPART" || (!isClock && Boolean(expr.daypart));

  if (!isClock && !isDaypart) {
    return {
      ok: false,
      error: "INVALID_TIME_EXPRESSION",
      message: "Ekspresi waktu tidak valid.",
    };
  }

  // 1. DAYPART RESOLUTION
  if (isDaypart) {
    const dp = String(expr.daypart || "PAGI").trim().toUpperCase() as DaypartType;

    // Kasus 1A: Tanggal eksplisit besok
    if (explicitDate === tomorrowDateStr) {
      const slotTime = dp === "PAGI" ? DAYPART_SLOTS.PAGI_TOMORROW : DAYPART_SLOTS[dp] || "08:00";
      const targetUtc = localDateTimeToUtc(tomorrowDateStr, timezone, `${slotTime}:00`);
      return {
        ok: true,
        due_at: targetUtc,
        due_at_iso: localIsoString(targetUtc, timezone),
        due_at_local_text: formatDueAtLocalText(targetUtc, timezone),
        planned_date: dateOnlyToDate(tomorrowDateStr),
        planned_date_string: tomorrowDateStr,
        has_specific_time: true,
        is_rollover_tomorrow: true,
      };
    }

    // Kasus 1B: Tanggal eksplisit hari ini
    if (explicitDate === todayDateStr) {
      const slotTime = dp === "PAGI" ? DAYPART_SLOTS.PAGI_TODAY : DAYPART_SLOTS[dp] || "08:30";
      const targetUtc = localDateTimeToUtc(todayDateStr, timezone, `${slotTime}:00`);
      if (targetUtc.getTime() <= now.getTime()) {
        return {
          ok: false,
          error: "PAST_TIME_WITH_EXPLICIT_DATE",
          message: "Waktu tersebut sudah lewat untuk hari ini. Silakan tentukan waktu lain.",
        };
      }
      return {
        ok: true,
        due_at: targetUtc,
        due_at_iso: localIsoString(targetUtc, timezone),
        due_at_local_text: formatDueAtLocalText(targetUtc, timezone),
        planned_date: dateOnlyToDate(todayDateStr),
        planned_date_string: todayDateStr,
        has_specific_time: true,
        is_rollover_tomorrow: false,
      };
    }

    // Kasus 1C: Tanggal eksplisit selain hari ini/besok
    if (explicitDate) {
      const slotTime = dp === "PAGI" ? DAYPART_SLOTS.PAGI_TOMORROW : DAYPART_SLOTS[dp] || "08:00";
      const targetUtc = localDateTimeToUtc(explicitDate, timezone, `${slotTime}:00`);
      if (targetUtc.getTime() <= now.getTime()) {
        return {
          ok: false,
          error: "PAST_TIME_WITH_EXPLICIT_DATE",
          message: "Tanggal tersebut sudah lewat.",
        };
      }
      return {
        ok: true,
        due_at: targetUtc,
        due_at_iso: localIsoString(targetUtc, timezone),
        due_at_local_text: formatDueAtLocalText(targetUtc, timezone),
        planned_date: dateOnlyToDate(explicitDate),
        planned_date_string: explicitDate,
        has_specific_time: true,
        is_rollover_tomorrow: false,
      };
    }

    // Kasus 1D: Tanpa date_hint (evaluasi margin masa depan)
    const slotToday = dp === "PAGI" ? DAYPART_SLOTS.PAGI_TODAY : DAYPART_SLOTS[dp] || "08:30";
    const candidateTodayUtc = localDateTimeToUtc(todayDateStr, timezone, `${slotToday}:00`);
    const marginMs = MIN_FUTURE_MARGIN_MINUTES * 60_000;

    if (candidateTodayUtc.getTime() >= now.getTime() + marginMs) {
      return {
        ok: true,
        due_at: candidateTodayUtc,
        due_at_iso: localIsoString(candidateTodayUtc, timezone),
        due_at_local_text: formatDueAtLocalText(candidateTodayUtc, timezone),
        planned_date: dateOnlyToDate(todayDateStr),
        planned_date_string: todayDateStr,
        has_specific_time: true,
        is_rollover_tomorrow: false,
      };
    }

    // Bergulir ke besok
    const slotTomorrow = dp === "PAGI" ? DAYPART_SLOTS.PAGI_TOMORROW : DAYPART_SLOTS[dp] || "08:00";
    const candidateTomorrowUtc = localDateTimeToUtc(tomorrowDateStr, timezone, `${slotTomorrow}:00`);
    return {
      ok: true,
      due_at: candidateTomorrowUtc,
      due_at_iso: localIsoString(candidateTomorrowUtc, timezone),
      due_at_local_text: formatDueAtLocalText(candidateTomorrowUtc, timezone),
      planned_date: dateOnlyToDate(tomorrowDateStr),
      planned_date_string: tomorrowDateStr,
      has_specific_time: true,
      is_rollover_tomorrow: true,
    };
  }

  // 2. CLOCK RESOLUTION
  let h = Number(expr.hour ?? 0);
  let m = Number(expr.minute ?? 0);

  if (Number.isNaN(h) || h < 0 || h > 23 || Number.isNaN(m) || m < 0 || m > 59) {
    return {
      ok: false,
      error: "INVALID_TIME_EXPRESSION",
      message: "Jam atau menit tidak valid.",
    };
  }

  const isHalfBefore = expr.half_before === true || String(expr.half_before) === "true";
  if (isHalfBefore) {
    // Setengah 8 = 07:30
    h = h === 0 ? 23 : h - 1;
    m = 30;
  }

  const period = expr.period ? String(expr.period).trim().toUpperCase() : null;
  if (period === "PAGI") {
    if (h === 12) h = 0;
  } else if (period === "SIANG") {
    if (h >= 1 && h <= 4) h += 12;
  } else if (period === "SORE") {
    if (h >= 1 && h <= 6) h += 12;
  } else if (period === "MALAM") {
    if (h >= 1 && h <= 11) h += 12;
  } else if (!period && h >= 1 && h <= 11) {
    // Ambigu antara AM dan PM jika tanpa petunjuk tanggal spesifik
    const marginMs = MIN_FUTURE_MARGIN_MINUTES * 60_000;
    const amTimeStr = `${pad2(h)}:${pad2(m)}:00`;
    const pmTimeStr = `${pad2(h + 12)}:${pad2(m)}:00`;

    if (!explicitDate) {
      const todayAmUtc = localDateTimeToUtc(todayDateStr, timezone, amTimeStr);
      const todayPmUtc = localDateTimeToUtc(todayDateStr, timezone, pmTimeStr);

      if (todayAmUtc.getTime() >= now.getTime() + marginMs) {
        h = h; // AM hari ini
      } else if (todayPmUtc.getTime() >= now.getTime() + marginMs) {
        h = h + 12; // PM hari ini
      } else {
        h = h; // AM besok
      }
    }
  }

  const timeStr = `${pad2(h)}:${pad2(m)}:00`;
  const marginMs = MIN_FUTURE_MARGIN_MINUTES * 60_000;

  if (explicitDate) {
    const targetUtc = localDateTimeToUtc(explicitDate, timezone, timeStr);
    if (targetUtc.getTime() <= now.getTime()) {
      return {
        ok: false,
        error: "PAST_TIME_WITH_EXPLICIT_DATE",
        message: "Waktu tersebut sudah lewat untuk tanggal yang ditentukan.",
      };
    }
    return {
      ok: true,
      due_at: targetUtc,
      due_at_iso: localIsoString(targetUtc, timezone),
      due_at_local_text: formatDueAtLocalText(targetUtc, timezone),
      planned_date: dateOnlyToDate(explicitDate),
      planned_date_string: explicitDate,
      has_specific_time: true,
      is_rollover_tomorrow: explicitDate === tomorrowDateStr,
    };
  }

  // Tanpa date_hint: cek hari ini vs besok
  const todayCandidateUtc = localDateTimeToUtc(todayDateStr, timezone, timeStr);
  if (todayCandidateUtc.getTime() >= now.getTime() + marginMs) {
    return {
      ok: true,
      due_at: todayCandidateUtc,
      due_at_iso: localIsoString(todayCandidateUtc, timezone),
      due_at_local_text: formatDueAtLocalText(todayCandidateUtc, timezone),
      planned_date: dateOnlyToDate(todayDateStr),
      planned_date_string: todayDateStr,
      has_specific_time: true,
      is_rollover_tomorrow: false,
    };
  }

  const tomorrowCandidateUtc = localDateTimeToUtc(tomorrowDateStr, timezone, timeStr);
  return {
    ok: true,
    due_at: tomorrowCandidateUtc,
    due_at_iso: localIsoString(tomorrowCandidateUtc, timezone),
    due_at_local_text: formatDueAtLocalText(tomorrowCandidateUtc, timezone),
    planned_date: dateOnlyToDate(tomorrowDateStr),
    planned_date_string: tomorrowDateStr,
    has_specific_time: true,
    is_rollover_tomorrow: true,
  };
}
