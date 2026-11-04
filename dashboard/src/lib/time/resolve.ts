import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import {
  formatDueAtLocalText,
  localDateString,
  localIsoString,
  normalizeIsoDateTime,
  resolveTimeExpression,
  type TimeExpressionInput,
} from "./index";
import { recordEvent } from "@/lib/events";

export interface ResolveTaskTimesParams {
  time_expression?: TimeExpressionInput | string | Record<string, unknown> | null;
  date_hint?: string | null;
  due_at?: string | Date | null;
  remind_at?: string | Date | null;
  has_specific_time?: boolean;
  is_reminder?: boolean;
  now?: Date;
  tz: string;
  default_due_time?: string;
}

export interface ResolveTaskTimesSuccess {
  ok: true;
  due_at: Date | null;
  due_at_iso: string | null;
  due_at_local_text: string | null;
  remind_at: Date | null;
  remind_at_iso: string | null;
  remind_at_local_text: string | null;
  planned_date: Date;
  planned_date_string: string;
  has_specific_time: boolean;
  alarm_will_fire: boolean;
  alarm_at_local_text: string | null;
  alarm_note: string;
}

export interface ResolveTaskTimesError {
  ok: false;
  error: "REMIND_AT_IN_PAST" | "HORIZON_EXCEEDED" | "INVALID_TIME" | "PAST_TIME_WITH_EXPLICIT_DATE" | "INVALID_TIME_EXPRESSION";
  message: string;
}

export type ResolveTaskTimesResult = ResolveTaskTimesSuccess | ResolveTaskTimesError;

const MAX_HORIZON_DAYS = 366;

/**
 * Parsing teks waktu fleksibel bahasa Indonesia (misal: "besok jam 8", "lusa sore", "hari ini").
 * @internal Dipanggil melalui fasad resolveTaskTimes
 */
export function parseFlexibleDueAt(val: unknown, timezone: string, now: Date = new Date()): string | null {
  if (val === null || val === undefined) return null;
  const raw = String(val).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const isTomorrow = lower.includes("besok") || lower.includes("tomorrow");
  const isDayAfter = lower.includes("lusa");
  const isToday = lower.includes("hari ini") || lower.includes("today");

  if (isTomorrow || isDayAfter || isToday) {
    const todayStr = localDateString(now, timezone);
    const anchor = new Date(`${todayStr}T00:00:00Z`);
    const offsetDays = isTomorrow ? 1 : isDayAfter ? 2 : 0;
    const targetDate = addDays(anchor, offsetDays);
    const targetDateStr = format(targetDate, "yyyy-MM-dd");

    let timeStr = "08:00:00";
    if (lower.includes("siang")) timeStr = "12:00:00";
    else if (lower.includes("sore")) timeStr = "15:00:00";
    else if (lower.includes("malam")) timeStr = "19:00:00";

    const utcDate = fromZonedTime(`${targetDateStr}T${timeStr}`, timezone);
    return localIsoString(utcDate, timezone);
  }

  try {
    return normalizeIsoDateTime(raw, timezone);
  } catch {
    return null;
  }
}

/**
 * Pintu tunggal (facade) kanonik untuk resolusi seluruh waktu dan alarm tugas Botseri.
 * Mengintegrasikan aturan INV-03, INV-05, batas Kasus A, validasi masa lampau, dan horizon.
 */
export function resolveTaskTimes(params: ResolveTaskTimesParams): ResolveTaskTimesResult {
  const now = params.now ?? new Date();
  const tz = params.tz || "Asia/Jakarta";
  const defaultDueTime = params.default_due_time || "17:00";

  const todayStr = localDateString(now, tz);
  const defaultPlannedDate = new Date(`${todayStr}T00:00:00Z`);

  let resolvedDueAt: Date | null = null;
  let resolvedRemindAt: Date | null = null;
  let hasSpecificTime = params.has_specific_time ?? false;
  let plannedDate = defaultPlannedDate;
  let plannedDateStr = todayStr;

  // 1. Parsing Input ISO awal jika disediakan
  if (params.due_at) {
    const isoStr = typeof params.due_at === "string"
      ? parseFlexibleDueAt(params.due_at, tz, now)
      : params.due_at.toISOString();
    const d = isoStr ? new Date(isoStr) : null;
    if (!d || Number.isNaN(d.getTime())) {
      return {
        ok: false,
        error: "INVALID_TIME",
        message: `Format due_at tidak valid: '${params.due_at}'`,
      };
    }
    resolvedDueAt = d;
    hasSpecificTime = true;
  }

  if (params.remind_at) {
    const isoStr = typeof params.remind_at === "string"
      ? parseFlexibleDueAt(params.remind_at, tz, now)
      : params.remind_at.toISOString();
    const d = isoStr ? new Date(isoStr) : null;
    if (!d || Number.isNaN(d.getTime())) {
      return {
        ok: false,
        error: "INVALID_TIME",
        message: `Format remind_at tidak valid: '${params.remind_at}'`,
      };
    }
    resolvedRemindAt = d;
    hasSpecificTime = true;
  }

  // 2. Evaluasi time_expression jika ada
  if (params.time_expression) {
    let exprInput: TimeExpressionInput | null = null;

    if (typeof params.time_expression === "object" && params.time_expression !== null) {
      exprInput = params.time_expression as TimeExpressionInput;
    } else if (typeof params.time_expression === "string") {
      try {
        exprInput = JSON.parse(params.time_expression);
      } catch {
        // Teks waktu bebas (bukan JSON)
        const parsedIso = parseFlexibleDueAt(params.time_expression, tz, now);
        if (parsedIso) {
          resolvedDueAt = new Date(parsedIso);
          hasSpecificTime = true;
        }
      }
    }

    if (exprInput) {
      const exprRes = resolveTimeExpression(
        now,
        tz,
        exprInput,
        params.date_hint || exprInput.date_hint
      );

      if (!exprRes.ok) {
        return {
          ok: false,
          error: exprRes.error as ResolveTaskTimesError["error"],
          message: exprRes.message,
        };
      }

      const exprDueAt = exprRes.due_at;

      // Penyelarasan Ekspresi vs ISO (Cek selisih > 5 menit)
      const targetIsoDate = params.is_reminder || params.remind_at ? resolvedRemindAt : resolvedDueAt;
      if (targetIsoDate) {
        const diffMinutes = Math.abs(exprDueAt.getTime() - targetIsoDate.getTime()) / 60_000;
        if (diffMinutes > 5) {
          void recordEvent("WARN", "time_resolver", "TIME_MISMATCH", {
            reason: "EXPRESSION_ISO_DISCREPANCY",
            diff_minutes: diffMinutes,
            time_expression: exprInput,
            iso_input: targetIsoDate.toISOString(),
            resolved_iso: exprRes.due_at_iso,
          });
        }
      }

      // Prioritaskan time_expression di atas ISO bawaan LLM
      if (params.is_reminder || (params.remind_at && !params.due_at)) {
        resolvedRemindAt = exprDueAt;
      } else {
        resolvedDueAt = exprDueAt;
      }

      plannedDate = exprRes.planned_date;
      plannedDateStr = exprRes.planned_date_string;
      hasSpecificTime = exprRes.has_specific_time;
    }
  }

  // 3. Validasi Horizon Maksimum (366 hari)
  const maxHorizonMs = MAX_HORIZON_DAYS * 24 * 3600_000;
  if (resolvedDueAt && resolvedDueAt.getTime() > now.getTime() + maxHorizonMs) {
    return {
      ok: false,
      error: "HORIZON_EXCEEDED",
      message: `Waktu tenggat melebihi batas maksimal ${MAX_HORIZON_DAYS} hari ke depan.`,
    };
  }
  if (resolvedRemindAt && resolvedRemindAt.getTime() > now.getTime() + maxHorizonMs) {
    return {
      ok: false,
      error: "HORIZON_EXCEEDED",
      message: `Waktu pengingat melebihi batas maksimal ${MAX_HORIZON_DAYS} hari ke depan.`,
    };
  }

  // 4. Validasi Penolakan Waktu Lampau
  // Toleransi 1 menit di masa lalu
  if (resolvedRemindAt && resolvedRemindAt.getTime() < now.getTime() - 60_000) {
    return {
      ok: false,
      error: "REMIND_AT_IN_PAST",
      message: "Waktu pengingat sudah terlewat.",
    };
  }

  // 5. Penetapan Planned Date berdasarkan tanggal referensi
  const refDate = resolvedDueAt ?? resolvedRemindAt;
  if (refDate) {
    plannedDateStr = localDateString(refDate, tz);
    plannedDate = new Date(`${plannedDateStr}T00:00:00Z`);
  }

  // 6. Penanganan Kasus A / B / C / D
  let finalDueAt = resolvedDueAt;
  let finalRemindAt = resolvedRemindAt;
  let alarmWillFire = false;
  let alarmAtLocalText: string | null = null;
  let alarmNote = "Tenggat terlalu dekat atau tanpa jam spesifik.";

  // Kasus C: Ada due_at dan remind_at eksplisit
  if (finalDueAt && finalRemindAt) {
    hasSpecificTime = true;
    alarmWillFire = true;
    alarmAtLocalText = formatDueAtLocalText(finalRemindAt, tz);
    alarmNote = "Pengingat disetel sesuai waktu yang ditentukan.";
  }
  // Kasus A: Ada due_at, tanpa remind_at eksplisit
  else if (finalDueAt && !finalRemindAt) {
    if (params.has_specific_time === false) {
      // Tugas harian tanpa jam spesifik
      finalDueAt = fromZonedTime(`${plannedDateStr}T${defaultDueTime}:00`, tz);
      finalRemindAt = null;
      hasSpecificTime = false;
      alarmWillFire = false;
      alarmAtLocalText = null;
      alarmNote = "Tugas tanpa jam spesifik (tidak ada alarm otomatis).";
    } else {
      hasSpecificTime = true;
      const R = Math.floor((finalDueAt.getTime() - now.getTime()) / 60_000);

      if (R >= 62) {
        // Kondisi 1: R >= 62 menit -> remind_at = due_at - 60 menit
        finalRemindAt = new Date(finalDueAt.getTime() - 60 * 60_000);
        alarmWillFire = true;
        alarmAtLocalText = formatDueAtLocalText(finalRemindAt, tz);
        alarmNote = "Pengingat disetel 60 menit sebelum tenggat.";
      } else if (R >= 12 && R < 62) {
        // Kondisi 2: 12 <= R < 62 menit -> remind_at = due_at - floor(R / 2)
        const halfR = Math.floor(R / 2);
        finalRemindAt = new Date(finalDueAt.getTime() - halfR * 60_000);
        alarmWillFire = true;
        alarmAtLocalText = formatDueAtLocalText(finalRemindAt, tz);
        alarmNote = `Pengingat disetel ${halfR} menit sebelum tenggat.`;
      } else {
        // Kondisi 3: R < 12 menit -> remind_at = null, alarm berbunyi pada due_at
        finalRemindAt = null;
        alarmWillFire = true;
        alarmAtLocalText = formatDueAtLocalText(finalDueAt, tz);
        alarmNote = "Tenggat kurang dari 12 menit, alarm akan berbunyi tepat pada waktu tenggat.";
      }
    }
  }
  // Kasus B: Ada remind_at, tanpa due_at
  else if (!finalDueAt && finalRemindAt) {
    hasSpecificTime = true;
    alarmWillFire = true;
    alarmAtLocalText = formatDueAtLocalText(finalRemindAt, tz);
    alarmNote = "Pengingat disetel sesuai waktu yang ditentukan.";
  }
  // Kasus D: Tanpa jam sama sekali
  else {
    hasSpecificTime = false;
    alarmWillFire = false;
    alarmAtLocalText = null;
    alarmNote = "Tenggat terlalu dekat atau tanpa jam spesifik.";
  }

  return {
    ok: true,
    due_at: finalDueAt,
    due_at_iso: finalDueAt ? localIsoString(finalDueAt, tz) : null,
    due_at_local_text: finalDueAt ? formatDueAtLocalText(finalDueAt, tz) : null,
    remind_at: finalRemindAt,
    remind_at_iso: finalRemindAt ? localIsoString(finalRemindAt, tz) : null,
    remind_at_local_text: finalRemindAt ? formatDueAtLocalText(finalRemindAt, tz) : null,
    planned_date: plannedDate,
    planned_date_string: plannedDateStr,
    has_specific_time: hasSpecificTime,
    alarm_will_fire: alarmWillFire,
    alarm_at_local_text: alarmAtLocalText,
    alarm_note: alarmNote,
  };
}
