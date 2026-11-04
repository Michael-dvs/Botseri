# Step 07 — n8n Proactive Scheduler

## 1. Goal

Membangun seluruh logika proaktif deterministik di dashboard dan menjadikan n8n hanya sebagai pemicu + pengirim:

- `tick` setiap 15 menit: normalisasi, pemulihan claim, retry Google, cek WAHA, klaim job atomik.
- Morning Brief, Work Hours Reminder, End-of-Day Evaluation dengan fallback tanpa LLM.
- Statistik harian, tier, snapshot `daily_stats`, dan rollover sekali per hari.
- Workflow `botseri-scheduler.json` tanpa tools dan tanpa aturan bisnis.

## 2. Prerequisites

- Step 06 selesai: inbound agent berjalan dan `syncTodo()` stabil.
- `bot_settings` terisi dan `compiled_prompt` tersedia.

## 3. File yang Dibuat / Dimodifikasi

```text
dashboard/src/
├── lib/
│   ├── stats/index.ts
│   ├── scheduler/
│   │   ├── slots.ts
│   │   ├── queries.ts
│   │   └── tick.ts
│   └── google/calendar.ts                 # tambah listCalendarEventsToday()
├── app/api/internal/scheduler/
│   ├── tick/route.ts
│   └── jobs/[jobId]/result/route.ts
└── tests/unit/
    ├── stats.test.ts
    └── scheduler-slots.test.ts

n8n-engine/workflows/
└── botseri-scheduler.json
```

## 4. Dashboard: Scheduler

### 4.1 `lib/stats/index.ts`

```ts
import type { EvalTier } from '@prisma/client';

export type DailyStats = {
  target_count: number;
  done_count: number;
  pending_count: number;
  completion_rate: number | null;
  tier: EvalTier;
};

export function computeDailyStats(target: number, done: number): DailyStats {
  if (target <= 0) {
    return {
      target_count: 0,
      done_count: 0,
      pending_count: 0,
      completion_rate: null,
      tier: 'NO_TASKS',
    };
  }

  const rate = (done / target) * 100;
  const tier: EvalTier = rate >= 70 ? 'HIGH' : rate >= 40 ? 'MID' : 'LOW';

  return {
    target_count: target,
    done_count: done,
    pending_count: target - done,
    completion_rate: rate,
    tier,
  };
}
```

### 4.2 `lib/scheduler/slots.ts`

```ts
import type { BotSettings } from '@prisma/client';
import { minutesOfDay } from '@/lib/time';

export type ReminderSlot = { index: number; startMinutes: number };

export function reminderSlots(settings: BotSettings): ReminderSlot[] {
  const start = minutesOfDay(settings.work_hours_start);
  const end = minutesOfDay(settings.work_hours_end);

  if (settings.behavior_mode === 'SANTAI' || settings.reminder_interval_minutes <= 0) {
    return [{ index: 1, startMinutes: Math.floor((start + end) / 2) }];
  }

  const slots: ReminderSlot[] = [];
  for (let index = 1; index <= 24; index += 1) {
    const slotStart = start + index * settings.reminder_interval_minutes;
    if (slotStart > end - 30) break;
    slots.push({ index, startMinutes: slotStart });
  }
  return slots;
}

export function activeReminderSlot(
  nowMinutes: number,
  settings: BotSettings,
): ReminderSlot | null {
  return (
    reminderSlots(settings).find(
      (slot) => nowMinutes >= slot.startMinutes && nowMinutes < slot.startMinutes + 30,
    ) ?? null
  );
}
```

### 4.3 `lib/scheduler/queries.ts`

```ts
import { prisma } from '@/lib/db';
import { localIsoString } from '@/lib/time';

export type ActiveTodoRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  priority_rank: number;
  priority_label: string | null;
  due_at: Date | null;
  has_specific_time: boolean;
  planned_date: Date;
  rollover_count: number;
  google_sync_status: string;
};

export async function getActiveRows(
  timezone: string,
  where: 'TODAY' | 'UPCOMING' | 'HIGH_PRIORITY',
  limit = 50,
  maxRank = 99,
): Promise<ActiveTodoRow[]> {
  const base = `
    SELECT id, title, description, category, status, priority_rank, priority_label,
           due_at, has_specific_time, planned_date, rollover_count, google_sync_status
    FROM v_active_todos
    WHERE true
  `;
  const today = localIsoString(new Date(), timezone).slice(0, 10);

  if (where === 'TODAY') {
    return prisma.$queryRawUnsafe<ActiveTodoRow[]>(
      `${base} AND planned_date <= $1::date
       ORDER BY priority_rank ASC, due_at ASC NULLS LAST, created_at ASC
       LIMIT $2`,
      today,
      limit,
    );
  }
  if (where === 'UPCOMING') {
    return prisma.$queryRawUnsafe<ActiveTodoRow[]>(
      `${base} AND planned_date > $1::date
       ORDER BY priority_rank ASC, due_at ASC NULLS LAST, created_at ASC
       LIMIT $2`,
      today,
      limit,
    );
  }
  return prisma.$queryRawUnsafe<ActiveTodoRow[]>(
    `${base} AND planned_date <= $1::date AND priority_rank <= $2
     ORDER BY priority_rank ASC, due_at ASC NULLS LAST, created_at ASC
     LIMIT $3`,
    today,
    maxRank,
    limit,
  );
}

export function mapActiveRows(rows: ActiveTodoRow[], timezone: string) {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    priority_rank: row.priority_rank,
    priority_label: row.priority_label,
    due_at: row.due_at ? localIsoString(row.due_at, timezone) : null,
    planned_date: row.planned_date.toISOString().slice(0, 10),
    hanging: row.rollover_count >= 3,
  }));
}
```

### 4.4 `lib/google/calendar.ts` — tambahan pembacaan agenda

Tambahkan pada file dari Step 05:

```ts
import { prisma } from '@/lib/db';
import { addDays, localDateString } from '@/lib/time';
import { fromZonedTime } from 'date-fns-tz';

export type CalendarEventSummary = {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
};

export async function listCalendarEventsToday(timezone: string): Promise<CalendarEventSummary[]> {
  const oauth = await prisma.oAuthToken.findFirst({ where: { provider: 'google' } });
  if (!oauth || oauth.status !== 'CONNECTED') return [];

  const today = localDateString(new Date(), timezone);
  const timeMin = fromZonedTime(`${today}T00:00:00`, timezone);
  const timeMax = fromZonedTime(`${addDays(today, 1)}T00:00:00`, timezone);

  const { calendar } = await getGoogleClients();
  const response = await calendar.events.list({
    calendarId: oauth.calendar_id ?? 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  return (response.data.items ?? []).map((event) => {
    const allDay = Boolean(event.start?.date && !event.start?.dateTime);
    return {
      title: event.summary ?? '(tanpa judul)',
      start: event.start?.dateTime ?? event.start?.date ?? '',
      end: event.end?.dateTime ?? event.end?.date ?? '',
      all_day: allDay,
    };
  });
}
```

> Bungkus pemanggilan di `tick` dengan `try/catch`; kegagalan Calendar tidak boleh menggagalkan brief.

### 4.5 `lib/google/sync.ts` — retry dengan backoff

Tambahkan pada file dari Step 05:

```ts
export async function retryPendingGoogleSync(limit = 20): Promise<void> {
  const candidates = await prisma.todo.findMany({
    where: {
      google_sync_status: { in: ['PENDING', 'FAILED'] },
      google_sync_attempts: { lt: 8 },
    },
    orderBy: { updated_at: 'asc' },
    take: limit * 2,
  });

  let processed = 0;
  for (const todo of candidates) {
    if (processed >= limit) break;
    const delayMinutes = Math.min(2 ** todo.google_sync_attempts, 60);
    if (Date.now() - todo.updated_at.getTime() < delayMinutes * 60_000) continue;
    await syncTodo(todo.id);
    processed += 1;
  }
}
```

> `syncTodo` menaikkan `google_sync_attempts` dan `updated_at` saat gagal, sehingga backoff berikutnya memakai kelipatan 2, 4, 8, … menit sampai 60 menit dan berhenti pada 8 percobaan.

### 4.6 `lib/scheduler/tick.ts`

```ts
import type { BotSettings, JobType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { recordEvent } from '@/lib/events';
import { renderPrompt } from '@/lib/prompt/render';
import { computeDailyStats } from '@/lib/stats';
import {
  addDays,
  isWorkingDay,
  localDateString,
  localDateTimeToUtc,
  localIsoString,
  localTimeString,
  nextWorkingDay,
} from '@/lib/time';
import { activeReminderSlot } from '@/lib/scheduler/slots';
import { getActiveRows, mapActiveRows } from '@/lib/scheduler/queries';
import { listCalendarEventsToday } from '@/lib/google/calendar';
import { retryPendingGoogleSync, syncTodo } from '@/lib/google/sync';
import { getSessionStatus } from '@/lib/waha/client';

export type SchedulerJob = {
  job_id: string;
  job_type: JobType;
  seq: number;
  chat_id: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  fallback_text: string;
};

type ClaimedRow = { id: string };

async function claimJob(
  localDate: string,
  jobType: JobType,
  seq: number,
): Promise<ClaimedRow | null> {
  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    INSERT INTO daily_execution_logs (local_date, job_type, seq, status, attempts, claimed_at)
    VALUES (${localDate}::date, ${jobType}::"JobType", ${seq}, 'CLAIMED'::"JobStatus", 1, now())
    ON CONFLICT (local_date, job_type, seq) DO UPDATE
      SET status = 'CLAIMED'::"JobStatus",
          attempts = daily_execution_logs.attempts + 1,
          claimed_at = now()
      WHERE daily_execution_logs.status = 'FAILED'::"JobStatus"
        AND daily_execution_logs.attempts < 3
    RETURNING id
  `;
  return rows[0] ?? null;
}

async function normalizeOverduePlannedDates(today: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE todos
    SET planned_date = ${today}::date
    WHERE status IN ('PENDING', 'IN_PROGRESS')
      AND planned_date < ${today}::date
  `;
}

async function recoverStaleClaims(now: Date): Promise<void> {
  await prisma.dailyExecutionLog.updateMany({
    where: {
      status: 'CLAIMED',
      claimed_at: { lt: new Date(now.getTime() - 10 * 60 * 1000) },
    },
    data: { status: 'FAILED', error: 'claim kedaluwarsa' },
  });
}

async function checkWahaSession(now: Date): Promise<void> {
  const status = await getSessionStatus();
  if (status.status === 'WORKING') return;

  const recent = await prisma.systemEvent.findFirst({
    where: {
      source: 'SCHEDULER',
      code: 'WAHA_NOT_WORKING',
      ts: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
    },
  });
  if (recent) return;

  await recordEvent({
    level: 'WARN',
    source: 'SCHEDULER',
    code: 'WAHA_NOT_WORKING',
    message: `Status sesi WAHA: ${status.status}`,
    context: { status: status.status },
  });
}

async function markMissedJob(localDate: string, jobType: JobType, seq: number): Promise<void> {
  await prisma.dailyExecutionLog.upsert({
    where: { local_date_job_type_seq: { local_date: new Date(`${localDate}T00:00:00Z`), job_type: jobType, seq } },
    update: {},
    create: {
      local_date: new Date(`${localDate}T00:00:00Z`),
      job_type: jobType,
      seq,
      status: 'SKIPPED',
      error: 'jendela pengiriman terlewat',
    },
  });
  await prisma.dailyExecutionLog.updateMany({
    where: {
      local_date: new Date(`${localDate}T00:00:00Z`),
      job_type: jobType,
      seq,
      status: 'FAILED',
    },
    data: { status: 'SKIPPED', error: 'jendela pengiriman terlewat' },
  });
}

function fallbackBrief(
  focus: ReturnType<typeof mapActiveRows>,
  rest: ReturnType<typeof mapActiveRows>,
  events: Array<{ title: string; start: string }>,
): string {
  const lines = ['Selamat pagi!', '', '🔥 3 Fokus Utama Pagi Ini:'];
  if (focus.length === 0) {
    lines.push('• Belum ada tugas untuk hari ini.');
  } else {
    focus.forEach((todo, index) => {
      lines.push(`${index + 1}. [${todo.priority_label ?? `P${todo.priority_rank}`}] ${todo.title}`);
    });
  }

  if (events.length > 0) {
    lines.push('', '🗓 Agenda hari ini:');
    events.forEach((event) => lines.push(`• ${event.title}`));
  }

  if (rest.length > 0) {
    lines.push('', '📋 Tugas Selanjutnya:');
    rest.slice(0, 5).forEach((todo) => lines.push(`• ${todo.title}`));
  }
  return lines.join('\n');
}

function fallbackReminder(
  todos: ReturnType<typeof mapActiveRows>,
  settings: BotSettings,
): string {
  const lines = ['Pengingat jam kerja:', 'Tugas prioritas tinggi yang masih pending:'];
  if (todos.length === 0) lines.push('• Tidak ada tugas prioritas tinggi.');
  else todos.slice(0, 5).forEach((todo) => lines.push(`• ${todo.title}`));
  lines.push('', `Sisa jam kerja sampai ${settings.work_hours_end}.`);
  return lines.join('\n');
}

function fallbackEod(
  stats: ReturnType<typeof computeDailyStats>,
  settings: BotSettings,
  rolledOver: number,
): string {
  const lines: string[] = [];
  if (stats.tier === 'NO_TASKS') {
    lines.push('Belum ada tugas yang dijadwalkan hari ini. Besok kita susun rencana lagi ya.');
  } else {
    const percent = Math.round(stats.completion_rate ?? 0);
    lines.push(`Evaluasi hari ini: ${stats.done_count}/${stats.target_count} tugas selesai (${percent}%).`);
    if (stats.tier === 'HIGH') lines.push('Kerja bagus! Jangan lupa istirahat.');
    else if (stats.tier === 'MID') lines.push('Cukup baik. Besok kita rapikan sisanya.');
    else if (settings.behavior_mode === 'STRICT') lines.push('Masih banyak yang tertinggal. Mari lebih disiplin besok.');
    else lines.push('Tidak apa-apa. Apakah kamu kelelahan atau kewalahan?');
  }
  if (rolledOver > 0) {
    lines.push('', `${rolledOver} tugas yang belum selesai sudah digeser ke hari kerja berikutnya.`);
  }
  return lines.join('\n');
}

async function buildBrief(
  jobRowId: string,
  settings: BotSettings,
  chatId: string,
  today: string,
): Promise<SchedulerJob> {
  const todayRows = await getActiveRows(settings.timezone, 'TODAY', 50);
  const upcomingRows = await getActiveRows(settings.timezone, 'UPCOMING', 10);

  let events: Array<{ title: string; start: string; end: string; all_day: boolean }> = [];
  try {
    events = await listCalendarEventsToday(settings.timezone);
  } catch (error) {
    await recordEvent({
      level: 'WARN',
      source: 'SCHEDULER',
      code: 'CALENDAR_READ_FAILED',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }

  const mapped = mapActiveRows(todayRows, settings.timezone);
  const focus = mapped.slice(0, 3);
  const rest = mapped.slice(3);
  const upcoming = mapActiveRows(upcomingRows, settings.timezone);

  const prompt = renderPrompt(settings.compiled_prompt ?? '', 'MORNING_BRIEF', {
    current_datetime: localIsoString(new Date(), settings.timezone),
    trigger_type: 'MORNING_BRIEF',
    active_todos: mapped,
    daily_stats: null,
    calendar_events_today: events,
    recent_messages: [],
  });

  const data = { focus, rest, upcoming, counts: { today: mapped.length, upcoming: upcoming.length }, events };

  return {
    job_id: jobRowId,
    job_type: 'MORNING_BRIEF',
    seq: 0,
    chat_id: chatId,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `Susun Morning Brief berdasarkan data berikut:\n${JSON.stringify(data)}` },
    ],
    fallback_text: fallbackBrief(focus, rest, events),
  };
}

async function buildReminder(
  jobRowId: string,
  seq: number,
  settings: BotSettings,
  chatId: string,
): Promise<SchedulerJob> {
  const rows = await getActiveRows(settings.timezone, 'HIGH_PRIORITY', 10, settings.reminder_max_rank);
  const mapped = mapActiveRows(rows, settings.timezone);

  const prompt = renderPrompt(settings.compiled_prompt ?? '', 'WORK_HOURS_REMINDER', {
    current_datetime: localIsoString(new Date(), settings.timezone),
    trigger_type: 'REMINDER',
    active_todos: mapped,
    daily_stats: null,
    calendar_events_today: [],
    recent_messages: [],
  });

  return {
    job_id: jobRowId,
    job_type: 'WORK_HOURS_REMINDER',
    seq,
    chat_id: chatId,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Buat pengingat singkat. Sekarang ${localTimeString(new Date(), settings.timezone)}. Data tugas:\n${JSON.stringify(mapped)}`,
      },
    ],
    fallback_text: fallbackReminder(mapped, settings),
  };
}

async function buildEod(
  jobRowId: string,
  settings: BotSettings,
  chatId: string,
  today: string,
  now: Date,
): Promise<SchedulerJob> {
  const [target, done, holidays, existingSnapshot] = await Promise.all([
    prisma.todo.count({ where: { planned_date: new Date(`${today}T00:00:00Z`), status: { not: 'CANCELLED' } } }),
    prisma.todo.count({ where: { planned_date: new Date(`${today}T00:00:00Z`), status: 'DONE' } }),
    prisma.holiday.findMany({ select: { date: true } }),
    prisma.dailyStat.findUnique({ where: { local_date: new Date(`${today}T00:00:00Z`) } }),
  ]);
  const stats = existingSnapshot
    ? {
        target_count: existingSnapshot.target_count,
        done_count: existingSnapshot.done_count,
        pending_count: existingSnapshot.pending_count,
        completion_rate: existingSnapshot.completion_rate
          ? Number(existingSnapshot.completion_rate)
          : null,
        tier: existingSnapshot.tier,
      }
    : computeDailyStats(target, done);
  const holidayDates = holidays.map((holiday) => holiday.date.toISOString().slice(0, 10));
  const nextDate = nextWorkingDay(today, settings.working_days, holidayDates);
  const endOfDay = localDateTimeToUtc(addDays(today, 1), '00:00', settings.timezone);

  const rolledOver = await prisma.$transaction(async (tx) => {
    const existing = await tx.dailyStat.findUnique({ where: { local_date: new Date(`${today}T00:00:00Z`) } });
    if (existing) return existing.rolled_over_count;

    await tx.dailyStat.create({
      data: {
        local_date: new Date(`${today}T00:00:00Z`),
        target_count: stats.target_count,
        done_count: stats.done_count,
        pending_count: stats.pending_count,
        completion_rate: stats.completion_rate,
        tier: stats.tier,
        rolled_over_count: 0,
      },
    });

    const pending = await tx.todo.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        planned_date: { lte: new Date(`${today}T00:00:00Z`) },
      },
      select: { id: true, due_at: true, google_sync_status: true },
    });

    for (const todo of pending) {
      const dueAt =
        todo.due_at && todo.due_at.getTime() <= endOfDay.getTime()
          ? localDateTimeToUtc(nextDate, settings.work_hours_start, settings.timezone)
          : todo.due_at;
      await tx.todo.update({
        where: { id: todo.id },
        data: {
          planned_date: new Date(`${nextDate}T00:00:00Z`),
          due_at: dueAt,
          rollover_count: { increment: 1 },
          google_sync_status:
            todo.google_sync_status === 'SYNCED' || todo.google_sync_status === 'PENDING'
              ? 'PENDING'
              : todo.google_sync_status,
        },
      });
    }

    await tx.dailyStat.update({
      where: { local_date: new Date(`${today}T00:00:00Z`) },
      data: { rolled_over_count: pending.length },
    });

    return pending.length;
  });

  // Sinkronkan hasil rollover tanpa menahan respons tick.
  const moved = await prisma.todo.findMany({
    where: {
      google_sync_status: 'PENDING',
      planned_date: new Date(`${nextDate}T00:00:00Z`),
    },
    select: { id: true },
    take: 20,
  });
  for (const todo of moved) await syncTodo(todo.id);

  const rows = await getActiveRows(settings.timezone, 'TODAY', 50);
  const mapped = mapActiveRows(rows, settings.timezone);

  const prompt = renderPrompt(settings.compiled_prompt ?? '', 'END_OF_DAY_EVAL', {
    current_datetime: localIsoString(now, settings.timezone),
    trigger_type: 'EOD_EVAL',
    active_todos: mapped,
    daily_stats: stats,
    calendar_events_today: [],
    recent_messages: [],
  });

  return {
    job_id: jobRowId,
    job_type: 'END_OF_DAY_EVAL',
    seq: 0,
    chat_id: chatId,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Susun evaluasi akhir hari. Statistik dihitung sistem:\n${JSON.stringify({ ...stats, rolled_over: rolledOver, next_working_day: nextDate })}`,
      },
    ],
    fallback_text: fallbackEod(stats, settings, rolledOver),
  };
}

export async function tick(now: Date = new Date()): Promise<{
  now_local: string;
  jobs: SchedulerJob[];
}> {
  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  if (!settings || !settings.bot_enabled || !settings.setup_completed) {
    return { now_local: localIsoString(now, settings?.timezone ?? 'Asia/Jakarta'), jobs: [] };
  }

  const timezone = settings.timezone;
  const today = localDateString(now, timezone);
  const nowMinutes = Number(localTimeString(now, timezone).slice(0, 2)) * 60
    + Number(localTimeString(now, timezone).slice(3, 5));

  await normalizeOverduePlannedDates(today);
  await recoverStaleClaims(now);
  await retryPendingGoogleSync(20);
  await checkWahaSession(now);

  const holidays = await prisma.holiday.findMany({ select: { date: true } });
  const holidayDates = holidays.map((holiday) => holiday.date.toISOString().slice(0, 10));
  if (!isWorkingDay(today, settings.working_days, holidayDates)) {
    return { now_local: localIsoString(now, timezone), jobs: [] };
  }

  const owner = await prisma.authorizedNumber.findFirst({
    where: { is_owner: true },
    orderBy: { id: 'asc' },
  });
  if (!owner) {
    return { now_local: localIsoString(now, timezone), jobs: [] };
  }

  const jobs: SchedulerJob[] = [];
  const briefStart = Number(settings.early_brief_time.slice(0, 2)) * 60 + Number(settings.early_brief_time.slice(3, 5));
  const workStart = Number(settings.work_hours_start.slice(0, 2)) * 60 + Number(settings.work_hours_start.slice(3, 5));
  const workEnd = Number(settings.work_hours_end.slice(0, 2)) * 60 + Number(settings.work_hours_end.slice(3, 5));

  // Morning Brief
  if (nowMinutes >= briefStart && nowMinutes < briefStart + settings.brief_window_minutes) {
    const claimed = await claimJob(today, 'MORNING_BRIEF', 0);
    if (claimed) jobs.push(await buildBrief(claimed.id, settings, owner.chat_id, today));
  } else if (nowMinutes >= briefStart + settings.brief_window_minutes) {
    await markMissedJob(today, 'MORNING_BRIEF', 0);
  }

  // Work Hours Reminder
  if (nowMinutes >= workStart && nowMinutes < workEnd) {
    const slot = activeReminderSlot(nowMinutes, settings);
    if (slot) {
      const sent = await prisma.dailyExecutionLog.count({
        where: {
          local_date: new Date(`${today}T00:00:00Z`),
          job_type: 'WORK_HOURS_REMINDER',
          status: 'SENT',
        },
      });
      const highPriority = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM v_active_todos
        WHERE planned_date <= ${today}::date
          AND priority_rank <= ${settings.reminder_max_rank}
      `;
      const hasPending = Number(highPriority[0]?.count ?? 0) > 0;

      if (sent < settings.reminder_max_per_day && hasPending) {
        const claimed = await claimJob(today, 'WORK_HOURS_REMINDER', slot.index);
        if (claimed) jobs.push(await buildReminder(claimed.id, slot.index, settings, owner.chat_id));
      }
    }
  }

  // End of Day
  if (nowMinutes >= workEnd && nowMinutes < workEnd + settings.eod_window_minutes) {
    const claimed = await claimJob(today, 'END_OF_DAY_EVAL', 0);
    if (claimed) jobs.push(await buildEod(claimed.id, settings, owner.chat_id, today, now));
  } else if (nowMinutes >= workEnd + settings.eod_window_minutes) {
    await markMissedJob(today, 'END_OF_DAY_EVAL', 0);
  }

  return { now_local: localIsoString(now, timezone), jobs };
}
```

> `markMissedJob` memakai `update: {}` agar baris `SENT`/`CLAIMED` tidak ditimpa. Baris yang belum ada dibuat `SKIPPED`. `attempts` default 1; tidak dikirim.
>
> `nowMinutes` di atas memakai `localTimeString` dua kali; ganti dengan helper `minutesOfTime(localTimeString(now, timezone))` bila ingin lebih rapi.

### 4.6 `app/api/internal/scheduler/tick/route.ts`

```ts
import { NextResponse } from 'next/server';
import { checkInternalAuth } from '@/lib/internal/auth';
import { tick } from '@/lib/scheduler/tick';
import { recordEvent } from '@/lib/events';

export async function POST(request: Request) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  const result = await tick(new Date());
  await recordEvent({
    level: 'DEBUG',
    source: 'SCHEDULER',
    code: 'TICK_OK',
    message: 'tick selesai',
    context: { jobs: result.jobs.length },
  });
  return NextResponse.json(result);
}
```

### 4.7 `app/api/internal/scheduler/jobs/[jobId]/result/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { checkInternalAuth } from '@/lib/internal/auth';
import { recordEvent } from '@/lib/events';

const schema = z.object({
  status: z.enum(['SENT', 'FAILED']),
  error: z.string().max(2000).nullable().optional(),
  // Ekstensi backward-compatible agar isi pesan dapat dicatat ke message_log (§11.3).
  body: z.string().max(5000).nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { jobId: string } },
) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const job = await prisma.dailyExecutionLog.findUnique({ where: { id: params.jobId } });
  if (!job) {
    return NextResponse.json({ error: 'job tidak ditemukan' }, { status: 404 });
  }

  const updated = await prisma.dailyExecutionLog.update({
    where: { id: job.id },
    data: {
      status: input.status,
      sent_at: input.status === 'SENT' ? new Date() : null,
      error: input.status === 'FAILED' ? input.error ?? 'pengiriman gagal' : null,
    },
  });

  if (input.status === 'SENT' && input.body) {
    const owner = await prisma.authorizedNumber.findFirst({ where: { is_owner: true } });
    if (owner) {
      await prisma.messageLog.create({
        data: {
          direction: 'OUTBOUND',
          chat_id: owner.chat_id,
          body: input.body,
        },
      });
    }
  }

  if (input.status === 'FAILED') {
    await recordEvent({
      level: 'ERROR',
      source: 'SCHEDULER',
      code: 'JOB_SEND_FAILED',
      message: input.error ?? 'pengiriman job gagal',
      context: { job_id: job.id, job_type: job.job_type, seq: job.seq },
    });
  }

  return NextResponse.json({ ok: true, status: updated.status });
}
```

## 5. Workflow `botseri-scheduler.json`

Simpan sebagai `n8n-engine/workflows/botseri-scheduler.json`:

```json
{
  "id": "botseriScheduler01",
  "name": "Botseri Scheduler",
  "active": true,
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": false
  },
  "nodes": [
    {
      "id": "schedule-15m",
      "name": "Setiap 15 Menit",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 300],
      "parameters": {
        "rule": {
          "interval": [{ "field": "minutes", "minutesInterval": 15 }]
        }
      }
    },
    {
      "id": "http-tick",
      "name": "Tick",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [220, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/scheduler/tick",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{}",
        "options": { "timeout": 60000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "if-jobs",
      "name": "Ada Job?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [440, 300],
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 2 },
          "conditions": [
            {
              "id": "jobs-present",
              "leftValue": "={{ $json.jobs?.length || 0 }}",
              "rightValue": 0,
              "operator": { "type": "number", "operation": "gt" }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      }
    },
    {
      "id": "split-jobs",
      "name": "Split Job",
      "type": "n8n-nodes-base.splitOut",
      "typeVersion": 1,
      "position": [660, 220],
      "parameters": {
        "fieldToSplitOut": "jobs",
        "options": {}
      }
    },
    {
      "id": "http-llm",
      "name": "LLM",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [880, 220],
      "onError": "continueRegularOutput",
      "alwaysOutputData": true,
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/llm/v1/chat/completions",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ model: 'botseri-default', messages: $json.messages, temperature: 0.4, max_tokens: 1000 }) }}",
        "options": { "timeout": 120000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "choose-text",
      "name": "Pilih Teks",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1100, 220],
      "parameters": {
        "jsCode": "const content = $json?.choices?.[0]?.message?.content;\nconst job = $('Split Job').item.json;\nconst text = String(content || job.fallback_text || '').trim();\nreturn [{ json: { text, job } }];"
      }
    },
    {
      "id": "http-send",
      "name": "Kirim WhatsApp",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1320, 220],
      "onError": "continueRegularOutput",
      "alwaysOutputData": true,
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/waha/send",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ chat_id: $('Pilih Teks').item.json.job.chat_id, body: $('Pilih Teks').item.json.text, trigger_type: $('Pilih Teks').item.json.job.job_type }) }}",
        "options": { "timeout": 30000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternal", "name": "Botseri Internal" }
      }
    },
    {
      "id": "result-status",
      "name": "Status Hasil",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1540, 220],
      "parameters": {
        "jsCode": "const job = $('Pilih Teks').item.json.job;\nconst text = $('Pilih Teks').item.json.text;\nconst sent = Boolean($json?.id) && Boolean(text);\nreturn [{ json: { job_id: job.job_id, status: sent ? 'SENT' : 'FAILED', error: sent ? null : 'WAHA sendText gagal atau teks kosong', body: text } }];"
      }
    },
    {
      "id": "http-result",
      "name": "Lapor Hasil",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1760, 220],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/scheduler/jobs/{{ $json.job_id }}/result",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ status: $json.status, error: $json.error, body: $json.body }) }}",
        "options": { "timeout": 15000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "noop-none",
      "name": "Tidak Ada Job",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [660, 380]
    }
  ],
  "connections": {
    "Setiap 15 Menit": {
      "main": [[{ "node": "Tick", "type": "main", "index": 0 }]]
    },
    "Tick": {
      "main": [[{ "node": "Ada Job?", "type": "main", "index": 0 }]]
    },
    "Ada Job?": {
      "main": [
        [{ "node": "Split Job", "type": "main", "index": 0 }],
        [{ "node": "Tidak Ada Job", "type": "main", "index": 0 }]
      ]
    },
    "Split Job": {
      "main": [[{ "node": "LLM", "type": "main", "index": 0 }]]
    },
    "LLM": {
      "main": [[{ "node": "Pilih Teks", "type": "main", "index": 0 }]]
    },
    "Pilih Teks": {
      "main": [[{ "node": "Kirim WhatsApp", "type": "main", "index": 0 }]]
    },
    "Kirim WhatsApp": {
      "main": [[{ "node": "Status Hasil", "type": "main", "index": 0 }]]
    },
    "Status Hasil": {
      "main": [[{ "node": "Lapor Hasil", "type": "main", "index": 0 }]]
    }
  }
}
```

## 6. Unit Test Wajib

`tests/unit/stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeDailyStats } from '@/lib/stats';

describe('computeDailyStats', () => {
  it('target 0 menjadi NO_TASKS tanpa rate', () => {
    const stats = computeDailyStats(0, 0);
    expect(stats.tier).toBe('NO_TASKS');
    expect(stats.completion_rate).toBeNull();
  });

  it('batas 40 tepat menjadi MID', () => {
    expect(computeDailyStats(10, 4).tier).toBe('MID');
    expect(computeDailyStats(10, 3).tier).toBe('LOW');
  });

  it('batas 70 tepat menjadi HIGH', () => {
    expect(computeDailyStats(10, 7).tier).toBe('HIGH');
    expect(computeDailyStats(10, 6.9).tier).toBe('MID');
  });

  it('rate tidak dibulatkan', () => {
    expect(computeDailyStats(3, 2).completion_rate).toBeCloseTo(66.666, 3);
  });
});
```

`tests/unit/scheduler-slots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { activeReminderSlot, reminderSlots } from '@/lib/scheduler/slots';
import type { BotSettings } from '@prisma/client';

const base = {
  behavior_mode: 'STRICT',
  reminder_interval_minutes: 120,
  work_hours_start: '08:00',
  work_hours_end: '17:00',
} as BotSettings;

describe('reminder slots', () => {
  it('STRICT menghasilkan slot kelipatan 120 sampai 16:30', () => {
    expect(reminderSlots(base).map((slot) => slot.startMinutes)).toEqual([600, 720, 840, 960]);
  });

  it('slot aktif selama 30 menit', () => {
    expect(activeReminderSlot(600, base)?.index).toBe(1);
    expect(activeReminderSlot(629, base)?.index).toBe(1);
    expect(activeReminderSlot(630, base)).toBeNull();
  });

  it('SANTAI memakai satu slot di tengah jam kerja', () => {
    expect(reminderSlots({ ...base, behavior_mode: 'SANTAI' })).toEqual([
      { index: 1, startMinutes: 750 },
    ]);
  });
});
```

## 7. Definition of Done

```bash
cd dashboard && npx vitest run tests/unit/stats.test.ts tests/unit/scheduler-slots.test.ts
cd .. && docker compose build botseri-n8n && docker compose up -d
docker compose logs -f botseri-n8n
```

Verifikasi manual:

1. Set `early_brief_time` ke 2 menit dari sekarang, `brief_window_minutes=5`.
2. Tunggu satu tick (atau jalankan `docker compose exec botseri-dashboard node -e "..."` tidak diperlukan; picu workflow manual dari n8n CLI):
   ```bash
   docker compose exec botseri-n8n n8n execute --id botseriScheduler01
   ```
3. Pesan Morning Brief masuk; `daily_execution_logs` memuat `MORNING_BRIEF` status `SENT`; `message_log` memuat OUTBOUND.
4. Matikan LLM (kosongkan `api_key_enc` sementara di DB uji), picu tick pada slot berikutnya → fallback terkirim tanpa error.
5. Set `work_hours_end` ke 2 menit lalu, `eod_window_minutes=5` → EOD terkirim.
6. Cek `daily_stats` dan rollover:
   ```bash
   docker exec botseri-db psql -U botseri -d botseri -c \
     "SELECT local_date, target_count, done_count, completion_rate, tier, rolled_over_count FROM daily_stats ORDER BY local_date DESC LIMIT 1;"
   docker exec botseri-db psql -U botseri -d botseri -c \
     "SELECT title, planned_date, due_at, rollover_count, google_sync_status FROM todos WHERE rollover_count > 0 ORDER BY updated_at DESC LIMIT 5;"
   ```
7. Panggil tick dua kali pada hari yang sama: jumlah job yang diklaim tidak bertambah; `daily_stats` tidak dihitung ulang.
8. Di luar jendela brief, baris `MORNING_BRIEF` berstatus `SKIPPED`.
9. Hentikan sesi WAHA → tick berikutnya mencatat `system_events` kode `WAHA_NOT_WORKING` paling banyak sekali per jam.

Kriteria lulus:

- Unit test batas tier dan slot hijau.
- Job proaktif tidak pernah dibuat tanpa claim.
- Brief tetap terkirim tanpa tugas.
- Fallback terkirim saat LLM gagal/kosong.
- Rollover sekali per hari dan `daily_stats` konsisten.
- Workflow scheduler tidak memuat aturan bisnis: hanya trigger, HTTP, pilihan teks, kirim, lapor.
- `message_log` mencatat pesan proaktif yang terkirim via `body` pada laporan hasil.
