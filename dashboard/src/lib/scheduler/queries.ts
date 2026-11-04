import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dateOnlyString, localDateString, localIsoString, localTimeString } from "@/lib/time";
import { recordEvent } from "@/lib/events";

export type ActiveTodoRow = {
  id: string;
  title: string;
  status: string;
  priority_rank: number | null;
  priority_label: string | null;
  due_at: Date | null;
  has_specific_time: boolean;
  planned_date: Date;
  rollover_count: number;
};

export type PromptTodo = {
  id: string;
  title: string;
  status: string;
  priority_rank: number | null;
  priority_label: string | null;
  due_at: string | null;
  planned_date: string;
  hanging: boolean;
};

export { getPrimaryOwner } from "@/lib/owner/primary";


export const DEFAULT_ALARM_CONFIG = {
  maxLatenessMinutes: 720,
  maxAttempts: 5,
  claimCooldownMinutes: 2,
  perTickCap: 3,
  onTimeThresholdMinutes: 5,
} as const;

export type AlarmTodoInput = {
  status: string;
  has_specific_time: boolean;
  due_at?: Date | string | null;
  remind_at?: Date | string | null;
  reminded_at: Date | string | null;
  reminder_attempts: number;
  reminder_claimed_at: Date | string | null;
};

export function isAlarmDue(
  todo: AlarmTodoInput,
  now: Date,
  config = DEFAULT_ALARM_CONFIG,
): boolean {
  if (todo.status !== "PENDING") return false;
  if (!todo.has_specific_time) return false;
  const targetTimeVal = todo.remind_at ?? todo.due_at;
  if (!targetTimeVal) return false;
  if (todo.reminded_at !== null && todo.reminded_at !== undefined) return false;
  if (todo.reminder_attempts >= config.maxAttempts) return false;

  const targetTime = new Date(targetTimeVal).getTime();
  const nowTime = now.getTime();

  // Belum jatuh tempo
  if (targetTime > nowTime) return false;

  // Melewati batas toleransi keterlambatan maksimal (12 jam)
  const maxLatenessMs = config.maxLatenessMinutes * 60_000;
  if (targetTime <= nowTime - maxLatenessMs) return false;

  // Cek cooldown klaim
  if (todo.reminder_claimed_at) {
    const claimedTime = new Date(todo.reminder_claimed_at).getTime();
    const cooldownMs = config.claimCooldownMinutes * 60_000;
    if (claimedTime >= nowTime - cooldownMs) return false;
  }

  return true;
}

export async function getPendingAlarms(now: Date) {
  return prisma.todo.findMany({
    where: {
      status: "PENDING",
      remind_at: {
        not: null,
        lte: now,
      },
      reminded_at: null,
    },
    orderBy: { remind_at: "asc" },
  });
}

export type ClaimedAlarmRow = {
  id: string;
  title: string;
  due_at: Date | null;
  remind_at: Date | null;
  reminder_attempts: number;
};

export async function claimDueTaskAlarms(
  now: Date,
  opts?: Partial<typeof DEFAULT_ALARM_CONFIG>,
): Promise<ClaimedAlarmRow[]> {
  const config = { ...DEFAULT_ALARM_CONFIG, ...opts };

  return prisma.$queryRaw<ClaimedAlarmRow[]>(Prisma.sql`
    UPDATE todos
    SET reminder_claimed_at = ${now},
        reminder_attempts   = reminder_attempts + 1
    WHERE id IN (
      SELECT id FROM todos
      WHERE status = 'PENDING'
        AND has_specific_time = true
        AND reminder_expired_at IS NULL
        AND (remind_at IS NOT NULL OR due_at IS NOT NULL)
        AND COALESCE(remind_at, due_at) <= ${now}
        AND COALESCE(remind_at, due_at) > (${now}::timestamptz - (${config.maxLatenessMinutes} * interval '1 minute'))
        AND reminded_at IS NULL
        AND reminder_attempts < ${config.maxAttempts}
        AND (reminder_claimed_at IS NULL
             OR reminder_claimed_at < (${now}::timestamptz - (${config.claimCooldownMinutes} * interval '1 minute')))
      ORDER BY COALESCE(remind_at, due_at) ASC
      LIMIT ${config.perTickCap}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, title, due_at, remind_at, reminder_attempts;
  `);
}

/**
 * Memproses alarm yang tertunda lebih dari 12 jam (max lateness).
 * Alih-alih dibuang diam-diam, tandai reminder_expired_at dan catat event ALARM_EXPIRED.
 */
export async function processExpiredAlarms(
  now: Date,
  maxLatenessMinutes = DEFAULT_ALARM_CONFIG.maxLatenessMinutes,
): Promise<number> {
  const cutoff = new Date(now.getTime() - maxLatenessMinutes * 60_000);
  const expiredTodos = await prisma.todo.findMany({
    where: {
      status: "PENDING",
      has_specific_time: true,
      reminder_expired_at: null,
      reminded_at: null,
      OR: [
        { remind_at: { not: null, lte: cutoff } },
        { remind_at: null, due_at: { not: null, lte: cutoff } },
      ],
    },
    select: { id: true, title: true },
    take: 50,
  });

  if (expiredTodos.length === 0) return 0;

  const ids = expiredTodos.map((t) => t.id);
  await prisma.todo.updateMany({
    where: { id: { in: ids } },
    data: { reminder_expired_at: now },
  });

  for (const t of expiredTodos) {
    void recordEvent("WARN", "SCHEDULER", "ALARM_EXPIRED", {
      todo_id: t.id,
      title: t.title,
      expired_at: now.toISOString(),
    });
  }

  return expiredTodos.length;
}

/**
 * Melepaskan klaim alarm yang menggantung lebih dari 5 menit tanpa selesai/gagal.
 */
export async function recoverStaleTaskClaims(
  now: Date,
  staleThresholdMinutes = 5,
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleThresholdMinutes * 60_000);
  const result = await prisma.todo.updateMany({
    where: {
      status: "PENDING",
      reminder_claimed_at: { lt: cutoff },
      reminded_at: null,
    },
    data: {
      reminder_claimed_at: null,
    },
  });

  if (result.count > 0) {
    void recordEvent("WARN", "SCHEDULER", "STALE_TASK_CLAIMS_RECOVERED", {
      count: result.count,
    });
  }

  return result.count;
}

export function sanitizeTitleForWhatsapp(rawTitle: string): string {
  return rawTitle
    .replace(/[*_~`]/g, "")
    .slice(0, 120)
    .trim();
}

export function formatTaskAlarm(params: {
  title: string;
  dueAt?: Date | null;
  remindAt?: Date | null;
  now?: Date;
  timezone: string;
}): string {
  const { title, dueAt, remindAt, timezone } = params;
  const now = params.now ?? new Date();
  const cleanTitle = sanitizeTitleForWhatsapp(title);

  const formatTime = (date: Date): string => {
    const timeStr = localTimeString(date, timezone);
    const suffix =
      timezone === "Asia/Jakarta"
        ? " WIB"
        : timezone === "Asia/Makassar"
          ? " WITA"
          : timezone === "Asia/Jayapura"
            ? " WIT"
            : "";
    return `${timeStr}${suffix}`;
  };

  if (dueAt && remindAt && dueAt.getTime() > remindAt.getTime()) {
    const diffMinutes = Math.round((dueAt.getTime() - now.getTime()) / 60000);
    const timeInfo = diffMinutes > 0 ? `${diffMinutes} menit lagi` : "sekarang";
    return `🔔 Pengingat: Tugas *${cleanTitle}* mendekati batas waktu (Tenggat: ${formatTime(dueAt)} · ${timeInfo}). Semangat tuntaskan ya!`;
  } else if (dueAt && !remindAt) {
    return `🔔 Pengingat: Batas waktu tugas *${cleanTitle}* tiba sekarang (${formatTime(dueAt)}).`;
  } else {
    // Skenario murni permintaan pengingat/agenda tanpa tenggat (due_at is null)
    const targetDate = remindAt ?? dueAt ?? now;
    const eventTime = formatTime(targetDate);
    return `🔔 Pengingat: Waktunya *${cleanTitle}* sekarang (${eventTime}). Semangat!`;
  }
}
function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} harus berupa bilangan bulat positif`);
  }
  return value;
}

export async function getActiveRows(
  timezone: string,
  where: "TODAY" | "UPCOMING" | "HIGH_PRIORITY",
  limit = 50,
  maxRank = 99,
): Promise<ActiveTodoRow[]> {
  positiveInteger(limit, "limit");
  positiveInteger(maxRank, "maxRank");
  const today = localDateString(new Date(), timezone);
  const condition =
    where === "TODAY"
      ? Prisma.sql`planned_date <= ${today}::date`
      : where === "UPCOMING"
        ? Prisma.sql`planned_date > ${today}::date`
        : Prisma.sql`planned_date <= ${today}::date AND priority_rank <= ${maxRank}`;

  return prisma.$queryRaw<ActiveTodoRow[]>(Prisma.sql`
    SELECT id, title, status, priority_rank, priority_label, due_at,
           has_specific_time, planned_date, rollover_count
    FROM v_active_todos
    WHERE ${condition}
    ORDER BY priority_rank ASC NULLS LAST, due_at ASC NULLS LAST, id ASC
    LIMIT ${limit}
  `);
}

export function mapActiveRows(rows: ActiveTodoRow[], timezone: string): PromptTodo[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority_rank: row.priority_rank,
    priority_label: row.priority_label,
    due_at: row.due_at ? localIsoString(row.due_at, timezone) : null,
    planned_date: dateOnlyString(row.planned_date),
    hanging: row.rollover_count >= 3,
  }));
}
