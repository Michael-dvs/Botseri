import {
  Prisma,
  type BotSettings,
  type PriorityLevel,
  type Todo,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildDedupeKey } from "@/lib/todos";
import { localDateString } from "@/lib/time";
import { resolveTaskTimes } from "@/lib/time/resolve";

export type ToolTodoInput = {
  title: string;
  description?: string | null;
  category?: string | null;
  priority_rank: number;
  due_at?: string | null;
  remind_at?: string | null;
  has_specific_time?: boolean;
};

export type ToolOrderInput = {
  customer_name: string;
  customer_contact?: string | null;
  description: string;
  event_date?: string | null;
  delivery_date?: string | null;
  delivery_address?: string | null;
  total_amount?: number | null;
  dp_amount?: number | null;
  payment_status?: "UNPAID" | "DP_PAID" | "PAID";
};

export type CreateTodoResult = {
  todo: Todo;
  deduplicated: boolean;
  warning: string | null;
};

export function resolvePriority(
  rank: number,
  levels: PriorityLevel[],
): { level: PriorityLevel; warning: string | null } {
  const exact = levels.find((level) => level.rank === rank);
  if (exact) return { level: exact, warning: null };
  if (levels.length === 0) {
    return {
      level: {
        id: "00000000-0000-0000-0000-000000000000",
        rank: 4,
        label: "Rutin",
        description: "Level fallback",
        rule_text: "",
        color: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      warning: "Priority Stack belum dikonfigurasi; menggunakan prioritas default Rutin",
    };
  }
  const lowest = [...levels].sort((a, b) => b.rank - a.rank)[0];
  return {
    level: lowest,
    warning: `priority_rank ${rank} tidak valid; dipakai rank ${lowest.rank} (${lowest.label})`,
  };
}

export function resolveDueAndReminder(
  input: ToolTodoInput,
  settings: BotSettings,
  nowParam?: Date,
): {
  dueAt: Date | null;
  remindAt: Date | null;
  plannedDate: Date;
  hasSpecificTime: boolean;
  alarmWillFire?: boolean;
  alarmAtLocalText?: string | null;
  alarmNote?: string;
} {
  const rawRef = input.due_at ?? input.remind_at;
  const parsedRef = rawRef ? new Date(rawRef) : null;
  const fallbackNow =
    parsedRef && !Number.isNaN(parsedRef.getTime()) && parsedRef.getTime() < Date.now() - 24 * 3600_000
      ? new Date(parsedRef.getTime() - 4 * 3600_000)
      : new Date();
  const effectiveNow = nowParam ?? fallbackNow;

  const res = resolveTaskTimes({
    due_at: input.due_at,
    remind_at: input.remind_at,
    has_specific_time: input.has_specific_time,
    now: effectiveNow,
    tz: settings.timezone,
    default_due_time: settings.default_due_time,
  });

  if (!res.ok) {
    const today = localDateString(new Date(), settings.timezone);
    return {
      dueAt: null,
      remindAt: null,
      plannedDate: new Date(`${today}T00:00:00Z`),
      hasSpecificTime: false,
      alarmWillFire: false,
      alarmAtLocalText: null,
      alarmNote: res.message,
    };
  }

  return {
    dueAt: res.due_at,
    remindAt: res.remind_at,
    plannedDate: res.planned_date,
    hasSpecificTime: res.has_specific_time,
    alarmWillFire: res.alarm_will_fire,
    alarmAtLocalText: res.alarm_at_local_text,
    alarmNote: res.alarm_note,
  };
}

export function resolveDueAt(
  input: ToolTodoInput,
  settings: BotSettings,
): { dueAt: Date | null; plannedDate: Date; hasSpecificTime: boolean } {
  const res = resolveDueAndReminder(input, settings);
  return {
    dueAt: res.dueAt,
    plannedDate: res.plannedDate,
    hasSpecificTime: res.hasSpecificTime,
  };
}

export async function createOrderForMessage(
  input: ToolOrderInput,
  sourceMessageId: string,
): Promise<string> {
  const marker = `botseri_source:${sourceMessageId}`;
  const existing = await prisma.order.findFirst({ where: { notes: marker } });
  if (existing) return existing.id;

  const order = await prisma.order.create({
    data: {
      customer_name: input.customer_name,
      customer_contact: input.customer_contact ?? null,
      description: input.description,
      event_date: input.event_date ? new Date(input.event_date) : null,
      delivery_date: input.delivery_date ? new Date(input.delivery_date) : null,
      delivery_address: input.delivery_address ?? null,
      total_amount: input.total_amount ?? null,
      dp_amount: input.dp_amount ?? null,
      payment_status: input.payment_status ?? "UNPAID",
      notes: marker,
    },
  });
  return order.id;
}

export async function createTodoIdempotent(params: {
  input: ToolTodoInput;
  settings: BotSettings;
  levels: PriorityLevel[];
  sourceMessageId: string;
  orderId: string | null;
}): Promise<CreateTodoResult> {
  const { input, settings, levels, sourceMessageId, orderId } = params;
  const { level, warning } = resolvePriority(input.priority_rank, levels);
  const { dueAt, remindAt, plannedDate, hasSpecificTime } = resolveDueAndReminder(input, settings);
  const dedupeKey = buildDedupeKey(sourceMessageId, input.title, dueAt ?? remindAt);

  if (dedupeKey) {
    const existing = await prisma.todo.findUnique({
      where: { dedupe_key: dedupeKey },
    });
    if (existing) return { todo: existing, deduplicated: true, warning };
  }

  try {
    const todo = await prisma.todo.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        priority_level_id: level.id,
        priority_rank: level.rank,
        due_at: dueAt,
        remind_at: remindAt,
        has_specific_time: hasSpecificTime,
        planned_date: plannedDate,
        order_id: orderId,
        source_message_id: sourceMessageId,
        dedupe_key: dedupeKey,
        created_via: "CHAT",
      },
    });
    return { todo, deduplicated: false, warning };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      dedupeKey
    ) {
      const existing = await prisma.todo.findUniqueOrThrow({
        where: { dedupe_key: dedupeKey },
      });
      return { todo: existing, deduplicated: true, warning };
    }
    throw error;
  }
}
