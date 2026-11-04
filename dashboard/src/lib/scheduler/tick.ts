import type { BotSettings, JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { listCalendarEventsToday, type CalendarEventSummary } from "@/lib/google/calendar";
import { retryPendingGoogleSync, syncTodo } from "@/lib/google/sync";
import { renderPrompt } from "@/lib/prompt/render";
import { activeReminderSlot } from "@/lib/scheduler/slots";
import {
  claimDueTaskAlarms,
  formatTaskAlarm,
  getActiveRows,
  getPrimaryOwner,
  mapActiveRows,
  type PromptTodo,
} from "@/lib/scheduler/queries";
import { computeDailyStats, type DailyStats } from "@/lib/stats";
import {
  dateOnlyString,
  dateOnlyToDate,
  isWorkingDay,
  localDateString,
  localDateTimeToUtc,
  localDayUtcBounds,
  localIsoString,
  localTimeString,
  minutesOfDay,
  nextWorkingDay,
} from "@/lib/time";
import { getSessionStatus } from "@/lib/waha/client";

export type SchedulerJob = {
  job_id: string;
  job_type: JobType | "TASK_ALARM";
  seq: number;
  chat_id: string;
  target_chat_id?: string;
  body?: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  fallback_text: string;
  skip_llm?: boolean;
  todo_id?: string;
};

type ClaimedRow = { id: string; attempts: number };

type FallbackBriefInput = {
  focus: PromptTodo[];
  rest: PromptTodo[];
  upcoming: PromptTodo[];
  events: CalendarEventSummary[];
};

export function isMinuteInWindow(now: number, start: number, duration: number): boolean {
  return now >= start && now < start + duration;
}

export function fallbackBrief(input: FallbackBriefInput): string {
  const lines = ["Selamat pagi.", "", "🔥 3 Fokus Utama Pagi Ini:"];
  if (input.focus.length === 0) lines.push("• Belum ada tugas aktif untuk hari ini.");
  else input.focus.forEach((todo, index) => lines.push(`${index + 1}. ${todo.title}`));

  lines.push("", "📋 Tugas Selanjutnya:");
  if (input.rest.length === 0 && input.upcoming.length === 0) {
    lines.push("• Belum ada tugas lanjutan. Tambahkan rencana saat sudah siap.");
  } else {
    [...input.rest, ...input.upcoming].slice(0, 5).forEach((todo) => lines.push(`• ${todo.title}`));
  }

  lines.push("", "🗓 Agenda hari ini:");
  if (input.events.length === 0) lines.push("• Tidak ada agenda kalender yang tersedia.");
  else input.events.slice(0, 5).forEach((event) => lines.push(`• ${event.title}${event.all_day ? " (sepanjang hari)" : ""}`));
  return lines.join("\n");
}

export function fallbackReminder(todos: PromptTodo[], workEnd: string): string {
  const lines = ["Pengingat jam kerja:"];
  if (todos.length === 0) lines.push("• Tidak ada tugas prioritas tinggi yang perlu dikejar.");
  else todos.slice(0, 5).forEach((todo) => lines.push(`• ${todo.title}${todo.hanging ? " (sudah lama menggantung)" : ""}`));
  lines.push("", `Jam kerja berakhir pukul ${workEnd}. Pilih satu tugas dan tuntaskan sekarang.`);
  return lines.join("\n");
}

export function fallbackEod(stats: DailyStats, rolledOver: number, nextDate: string): string {
  const lines: string[] = [];
  if (stats.tier === "NO_TASKS") {
    lines.push("Belum ada tugas yang dijadwalkan hari ini. Susun rencana untuk hari kerja berikutnya.");
  } else {
    lines.push(`Evaluasi hari ini: ${stats.done_count}/${stats.target_count} tugas selesai (${Math.round(stats.completion_rate ?? 0)}%).`);
    if (stats.tier === "HIGH") lines.push("Hasil hari ini kuat. Saatnya istirahat dengan tenang.");
    else if (stats.tier === "MID") lines.push("Progresnya cukup baik. Besok lanjutkan dari tugas yang paling penting.");
    else lines.push("Masih banyak yang tertahan. Besok mulai dari satu tugas paling penting.");
  }
  if (rolledOver > 0) lines.push(`${rolledOver} tugas digeser ke ${nextDate}.`);
  else lines.push("Tidak ada tugas aktif yang perlu digeser.");
  return lines.join("\n");
}

async function claimJob(localDate: string, jobType: JobType, seq: number): Promise<ClaimedRow | null> {
  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    INSERT INTO daily_execution_logs (local_date, job_type, seq, status, attempts, claimed_at)
    VALUES (${localDate}::date, ${jobType}::"JobType", ${seq}, 'CLAIMED'::"JobStatus", 1, now())
    ON CONFLICT (local_date, job_type, seq) DO UPDATE
      SET status = 'CLAIMED'::"JobStatus",
          attempts = daily_execution_logs.attempts + 1,
          claimed_at = now(),
          error = NULL
      WHERE daily_execution_logs.status = 'FAILED'::"JobStatus"
        AND daily_execution_logs.attempts < 3
    RETURNING id, attempts
  `;
  return rows[0] ?? null;
}

async function normalizeOverduePlannedDates(today: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE todos
    SET planned_date = ${today}::date, updated_at = now()
    WHERE status IN ('PENDING'::"TodoStatus", 'IN_PROGRESS'::"TodoStatus")
      AND planned_date < ${today}::date
  `;
}

async function recoverStaleClaims(now: Date): Promise<void> {
  const result = await prisma.dailyExecutionLog.updateMany({
    where: { status: "CLAIMED", claimed_at: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: "FAILED", error: "claim kedaluwarsa" },
  });
  if (result.count > 0) {
    await recordEvent("WARN", "SCHEDULER", "STALE_CLAIM_RECOVERED", { count: result.count });
  }
}

async function hourlyEventExists(code: string, now: Date): Promise<boolean> {
  return Boolean(await prisma.systemEvent.findFirst({
    where: { source: "SCHEDULER", code, ts: { gte: new Date(now.getTime() - 60 * 60_000) } },
    select: { id: true },
  }));
}

async function checkWahaSession(now: Date): Promise<void> {
  const status = await getSessionStatus();
  if (status.status === "WORKING" || await hourlyEventExists("WAHA_NOT_WORKING", now)) return;
  await recordEvent("WARN", "SCHEDULER", "WAHA_NOT_WORKING", { status: status.status });
}

async function isolatedHousekeeping(name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    await recordEvent("ERROR", "SCHEDULER", "HOUSEKEEPING_FAILED", {
      step: name,
      error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
    });
  }
}

async function markMissedJob(localDate: string, jobType: JobType, seq: number): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO daily_execution_logs (local_date, job_type, seq, status, attempts, claimed_at, error)
      VALUES (${localDate}::date, ${jobType}::"JobType", ${seq}, 'SKIPPED'::"JobStatus", 1, now(), 'jendela pengiriman terlewat')
      ON CONFLICT (local_date, job_type, seq) DO NOTHING
    `,
    prisma.dailyExecutionLog.updateMany({
      where: { local_date: dateOnlyToDate(localDate), job_type: jobType, seq, status: "FAILED" },
      data: { status: "SKIPPED", error: "jendela pengiriman terlewat" },
    }),
  ]);
}

function schedulerMessages(
  settings: BotSettings,
  trigger: JobType,
  now: Date,
  data: Record<string, unknown>,
): SchedulerJob["messages"] {
  const system = renderPrompt(settings.compiled_prompt ?? "", trigger, {
    current_datetime: localIsoString(now, settings.timezone),
    trigger_type: trigger,
    active_todos: data.active_todos ?? [],
    untimed_recent_todos: [],
    daily_stats: data.daily_stats ?? null,
    calendar_events_today: data.calendar_events_today ?? [],
    recent_messages: [],
  });
  const style = "Gunakan Bahasa Indonesia yang ramah, langsung, dan berbobot. Jangan menghitung ulang data. Jangan gunakan heading markdown, tabel, atau karakter em dash.";
  return [
    { role: "system", content: system },
    { role: "user", content: `${style}\nData siap pakai:\n${JSON.stringify(data)}` },
  ];
}

async function buildBrief(
  jobId: string,
  settings: BotSettings,
  chatId: string,
  now: Date,
): Promise<SchedulerJob> {
  const [todayRows, upcomingRows, highPriorityRows] = await Promise.all([
    getActiveRows(settings.timezone, "TODAY", 50),
    getActiveRows(settings.timezone, "UPCOMING", 10),
    getActiveRows(settings.timezone, "HIGH_PRIORITY", 10, settings.reminder_max_rank),
  ]);
  let events: CalendarEventSummary[] = [];
  try {
    events = await listCalendarEventsToday(settings.timezone);
  } catch (error) {
    await recordEvent("WARN", "SCHEDULER", "GOOGLE_CALENDAR_READ_FAILED", {
      error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
    });
  }
  const today = mapActiveRows(todayRows, settings.timezone);
  const upcoming = mapActiveRows(upcomingRows, settings.timezone);
  const highPriority = mapActiveRows(highPriorityRows, settings.timezone);
  const focus = today.slice(0, 3);
  const rest = today.slice(3);
  const data = {
    active_todos: today,
    focus,
    rest,
    upcoming,
    high_priority: highPriority,
    counts: { today: today.length, upcoming: upcoming.length },
    calendar_events_today: events,
  };
  return {
    job_id: jobId,
    job_type: "MORNING_BRIEF",
    seq: 0,
    chat_id: chatId,
    messages: schedulerMessages(settings, "MORNING_BRIEF", now, data),
    fallback_text: fallbackBrief({ focus, rest, upcoming, events }),
  };
}

async function buildReminder(
  jobId: string,
  seq: number,
  settings: BotSettings,
  chatId: string,
  now: Date,
  todos: PromptTodo[],
): Promise<SchedulerJob> {
  const data = {
    active_todos: todos,
    current_time: localTimeString(now, settings.timezone),
    work_hours_end: settings.work_hours_end,
  };
  return {
    job_id: jobId,
    job_type: "WORK_HOURS_REMINDER",
    seq,
    chat_id: chatId,
    messages: schedulerMessages(settings, "WORK_HOURS_REMINDER", now, data),
    fallback_text: fallbackReminder(todos, settings.work_hours_end),
  };
}

async function buildEod(
  jobId: string,
  settings: BotSettings,
  chatId: string,
  today: string,
  now: Date,
  holidayDates: string[],
): Promise<SchedulerJob> {
  const todayDate = dateOnlyToDate(today);
  const nextDate = nextWorkingDay(now, settings.timezone, settings.working_days, holidayDates);
  const { end: endOfToday } = localDayUtcBounds(now, settings.timezone);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.dailyStat.findUnique({ where: { local_date: todayDate } });
    if (existing) {
      return {
        stats: {
          target_count: existing.target_count,
          done_count: existing.done_count,
          pending_count: existing.pending_count,
          completion_rate: existing.completion_rate === null ? null : Number(existing.completion_rate),
          tier: existing.tier,
        } satisfies DailyStats,
        rolledOver: existing.rolled_over_count,
        movedIds: [] as string[],
        movedTitles: [] as string[],
      };
    }

    const [target, done, pending] = await Promise.all([
      tx.todo.count({ where: { planned_date: todayDate, status: { not: "CANCELLED" } } }),
      tx.todo.count({ where: { planned_date: todayDate, status: "DONE" } }),
      tx.todo.findMany({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] }, planned_date: { lte: todayDate } },
        select: { id: true, title: true, due_at: true, has_specific_time: true, google_sync_status: true },
        orderBy: { id: "asc" },
      }),
    ]);
    const stats = computeDailyStats(target, done);

    // Tugas berjam spesifik yang due_at-nya masih di masa depan pada saat EOD (mis. 19:35 saat EOD 17:00)
    // DILARANG ikut dirollover hari ini agar alarmnya berbunyi.
    const toRollOver = pending.filter(
      (todo) => !(todo.has_specific_time && todo.due_at && todo.due_at > now),
    );

    await tx.dailyStat.create({
      data: {
        local_date: todayDate,
        target_count: stats.target_count,
        done_count: stats.done_count,
        pending_count: stats.pending_count,
        completion_rate: stats.completion_rate,
        tier: stats.tier,
        rolled_over_count: toRollOver.length,
      },
    });

    for (const todo of toRollOver) {
      const dueAt = todo.due_at && todo.due_at < endOfToday
        ? localDateTimeToUtc(nextDate, settings.timezone, `${settings.work_hours_start}:00`)
        : todo.due_at;

      const isResetReminder = Boolean(dueAt && dueAt > now);

      await tx.todo.update({
        where: { id: todo.id },
        data: {
          planned_date: dateOnlyToDate(nextDate),
          due_at: dueAt,
          rollover_count: { increment: 1 },
          google_sync_status: ["SYNCED", "PENDING"].includes(todo.google_sync_status)
            ? "PENDING"
            : todo.google_sync_status,
          ...(isResetReminder
            ? {
                reminded_at: null,
                reminder_claimed_at: null,
                reminder_attempts: 0,
              }
            : {}),
        },
      });
    }

    return {
      stats,
      rolledOver: toRollOver.length,
      movedIds: toRollOver.filter((todo) => ["SYNCED", "PENDING"].includes(todo.google_sync_status)).map((todo) => todo.id),
      movedTitles: toRollOver.map((todo) => todo.title),
    };
  });

  for (const todoId of result.movedIds) {
    try {
      await syncTodo(todoId);
    } catch (error) {
      await recordEvent("ERROR", "SCHEDULER", "GOOGLE_SYNC_RETRY_FAILED", {
        todo_id: todoId,
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      });
    }
  }

  const data = {
    active_todos: result.movedTitles,
    daily_stats: result.stats,
    rolled_over: result.rolledOver,
    next_working_day: nextDate,
  };
  return {
    job_id: jobId,
    job_type: "END_OF_DAY_EVAL",
    seq: 0,
    chat_id: chatId,
    messages: schedulerMessages(settings, "END_OF_DAY_EVAL", now, data),
    fallback_text: fallbackEod(result.stats, result.rolledOver, nextDate),
  };
}

async function warnShortWindows(settings: BotSettings, now: Date): Promise<void> {
  const short = [
    ["brief_window_minutes", settings.brief_window_minutes],
    ["eod_window_minutes", settings.eod_window_minutes],
  ].filter(([, value]) => Number(value) < 15);
  if (short.length === 0 || await hourlyEventExists("SCHEDULER_WINDOW_TOO_SHORT", now)) return;
  await recordEvent("WARN", "SCHEDULER", "SCHEDULER_WINDOW_TOO_SHORT", {
    windows: Object.fromEntries(short),
  });
}

async function pruneOldTickEvents(now: Date): Promise<void> {
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60_000);
  await prisma.systemEvent.deleteMany({
    where: {
      source: "SCHEDULER",
      code: "TICK_OK",
      ts: { lt: twoDaysAgo },
    },
  });
}

export async function tick(now: Date = new Date()): Promise<{ now_local: string; jobs: SchedulerJob[] }> {
  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  const timezone = settings?.timezone ?? "Asia/Jakarta";
  const nowLocal = localIsoString(now, timezone);
  if (!settings || !settings.bot_enabled || !settings.setup_completed) return { now_local: nowLocal, jobs: [] };

  const today = localDateString(now, timezone);
  await isolatedHousekeeping("normalizeOverduePlannedDates", () => normalizeOverduePlannedDates(today));
  await isolatedHousekeeping("recoverStaleClaims", () => recoverStaleClaims(now));
  await isolatedHousekeeping("retryPendingGoogleSync", () => retryPendingGoogleSync(20));
  await isolatedHousekeeping("checkWahaSession", () => checkWahaSession(now));
  await isolatedHousekeeping("warnShortWindows", () => warnShortWindows(settings, now));
  await isolatedHousekeeping("pruneOldTickEvents", () => pruneOldTickEvents(now));

  const owner = await getPrimaryOwner();
  if (!owner) {
    if (!await hourlyEventExists("SCHEDULER_NO_OWNER", now)) {
      await recordEvent("ERROR", "SCHEDULER", "SCHEDULER_NO_OWNER");
    }
    return { now_local: nowLocal, jobs: [] };
  }

  const jobs: SchedulerJob[] = [];

  // EVALUASI ALARM TUGAS SPESIFIK (Berjalan di luar gating hari kerja / jam kerja)
  try {
    const claimedAlarms = await claimDueTaskAlarms(now);
    const targetChatId = owner.phone_e164
      ? `${owner.phone_e164.replace(/\D/g, "")}@c.us`
      : owner.chat_id;

    for (const alarm of claimedAlarms) {
      const alarmText = formatTaskAlarm({
        title: alarm.title,
        dueAt: alarm.due_at,
        remindAt: alarm.remind_at,
        now,
        timezone,
      });

      jobs.push({
        job_id: `alarm:${alarm.id}:${alarm.reminder_attempts}`,
        job_type: "TASK_ALARM",
        seq: alarm.reminder_attempts,
        chat_id: targetChatId,
        target_chat_id: targetChatId,
        body: alarmText,
        fallback_text: alarmText,
        messages: [{ role: "system", content: "TASK_ALARM" }],
        skip_llm: true,
        todo_id: alarm.id,
      });
    }
  } catch (alarmError) {
    await recordEvent("ERROR", "SCHEDULER", "TASK_ALARM_EVALUATION_FAILED", {
      error: alarmError instanceof Error ? alarmError.message : String(alarmError),
    });
  }

  // Gating hari kerja & hari libur untuk job makro (Morning Brief, Work Hours Reminder, EOD)
  const holidays = await prisma.holiday.findMany({ select: { date: true } });
  const holidayDates = holidays.map((holiday) => dateOnlyString(holiday.date));
  if (!isWorkingDay(now, timezone, settings.working_days, holidayDates)) {
    return { now_local: nowLocal, jobs };
  }
  const nowMinutes = minutesOfDay(localTimeString(now, timezone));
  const briefStart = minutesOfDay(settings.early_brief_time);
  const workStart = minutesOfDay(settings.work_hours_start);
  const workEnd = minutesOfDay(settings.work_hours_end);

  if (isMinuteInWindow(nowMinutes, briefStart, settings.brief_window_minutes)) {
    const claimed = await claimJob(today, "MORNING_BRIEF", 0);
    if (claimed) jobs.push(await buildBrief(claimed.id, settings, owner.chat_id, now));
  } else if (nowMinutes >= briefStart + settings.brief_window_minutes) {
    await markMissedJob(today, "MORNING_BRIEF", 0);
  }

  if (nowMinutes >= workStart && nowMinutes < workEnd) {
    const slot = activeReminderSlot(nowMinutes, settings);
    if (slot) {
      const [quotaUsed, rows] = await Promise.all([
        prisma.dailyExecutionLog.count({
          where: {
            local_date: dateOnlyToDate(today),
            job_type: "WORK_HOURS_REMINDER",
            status: { in: ["SENT", "CLAIMED"] },
          },
        }),
        getActiveRows(timezone, "HIGH_PRIORITY", 10, settings.reminder_max_rank),
      ]);
      if (quotaUsed < settings.reminder_max_per_day && rows.length > 0) {
        const claimed = await claimJob(today, "WORK_HOURS_REMINDER", slot.index);
        if (claimed) {
          jobs.push(await buildReminder(
            claimed.id,
            slot.index,
            settings,
            owner.chat_id,
            now,
            mapActiveRows(rows, timezone),
          ));
        }
      }
    }
  }

  if (isMinuteInWindow(nowMinutes, workEnd, settings.eod_window_minutes)) {
    const claimed = await claimJob(today, "END_OF_DAY_EVAL", 0);
    if (claimed) jobs.push(await buildEod(claimed.id, settings, owner.chat_id, today, now, holidayDates));
  } else if (nowMinutes >= workEnd + settings.eod_window_minutes) {
    await markMissedJob(today, "END_OF_DAY_EVAL", 0);
  }

  return { now_local: nowLocal, jobs };
}
