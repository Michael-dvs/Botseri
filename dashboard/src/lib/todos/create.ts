import {
  Prisma,
  type BotSettings,
  type PriorityLevel,
  type Todo,
} from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { buildDedupeKey } from "@/lib/todos";
import { localDateString } from "@/lib/time";

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
): {
  dueAt: Date | null;
  remindAt: Date | null;
  plannedDate: Date;
  hasSpecificTime: boolean;
} {
  const today = localDateString(new Date(), settings.timezone);
  const defaultPlannedDate = new Date(`${today}T00:00:00Z`);

  const rawDue = input.due_at ? new Date(input.due_at) : null;
  const parsedDue = rawDue && !Number.isNaN(rawDue.getTime()) ? rawDue : null;

  const rawRemind = input.remind_at ? new Date(input.remind_at) : null;
  const parsedRemind = rawRemind && !Number.isNaN(rawRemind.getTime()) ? rawRemind : null;

  let dueAt: Date | null = null;
  let remindAt: Date | null = null;
  let hasSpecificTime = false;
  let refDate: Date | null = null;

  // Kasus C: Ada due_at dan remind_at
  if (parsedDue && parsedRemind) {
    dueAt = parsedDue;
    remindAt = parsedRemind;
    hasSpecificTime = true;
    refDate = parsedDue;
  }
  // Kasus A: Ada due_at, tanpa remind_at
  else if (parsedDue && !parsedRemind) {
    refDate = parsedDue;
    if (input.has_specific_time === false) {
      const localDate = localDateString(parsedDue, settings.timezone);
      dueAt = fromZonedTime(
        `${localDate}T${settings.default_due_time}:00`,
        settings.timezone,
      );
      remindAt = null;
      hasSpecificTime = false;
    } else {
      dueAt = parsedDue;
      remindAt = new Date(parsedDue.getTime() - 60 * 60 * 1000);
      hasSpecificTime = true;
    }
  }
  // Kasus B: Ada remind_at, tanpa due_at
  else if (!parsedDue && parsedRemind) {
    dueAt = null;
    remindAt = parsedRemind;
    hasSpecificTime = true;
    refDate = parsedRemind;
  }
  // Kasus D: Tanpa jam sama sekali
  else {
    dueAt = null;
    remindAt = null;
    hasSpecificTime = false;
    refDate = null;
  }

  const plannedDate = refDate
    ? new Date(`${localDateString(refDate, settings.timezone)}T00:00:00Z`)
    : defaultPlannedDate;

  return {
    dueAt,
    remindAt,
    plannedDate,
    hasSpecificTime,
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
