export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { TodoStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { localDateString } from "@/lib/time";
import { syncTodo } from "@/lib/google/sync";

const TODO_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
  priority_rank: z.number().int().min(1),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  has_specific_time: z.boolean(),
  planned_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  if (status && !TODO_STATUSES.includes(status as (typeof TODO_STATUSES)[number])) {
    return NextResponse.json(
      { ok: false, error: "status tidak valid" },
      { status: 400 },
    );
  }

  const todos = await prisma.todo.findMany({
    where: status ? { status: status as TodoStatus } : {},
    orderBy: [
      { priority_rank: "asc" },
      { due_at: { sort: "asc", nulls: "last" } },
      { created_at: "asc" },
    ],
    take: 200,
  });

  return NextResponse.json({ ok: true, todos });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const [level, settings] = await Promise.all([
    prisma.priorityLevel.findUnique({
      where: { rank: input.priority_rank },
    }),
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);

  if (!level) {
    return NextResponse.json(
      { ok: false, error: "priority_rank tidak ada" },
      { status: 400 },
    );
  }

  const dueAt = input.due_at ? new Date(input.due_at) : null;
  const plannedDate =
    input.planned_date ??
    (dueAt
      ? localDateString(dueAt, settings.timezone)
      : localDateString(new Date(), settings.timezone));
  const plannedDateValue = new Date(`${plannedDate}T00:00:00Z`);
  if (Number.isNaN(plannedDateValue.getTime())) {
    return NextResponse.json(
      { ok: false, error: "planned_date tidak valid" },
      { status: 400 },
    );
  }

  try {
    const todo = await prisma.todo.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        priority_rank: level.rank,
        priority_level_id: level.id,
        due_at: dueAt,
        has_specific_time: input.has_specific_time,
        planned_date: plannedDateValue,
        status: "PENDING",
        created_via: "DASHBOARD",
      },
    });
    await syncTodo(todo.id);
    const refreshed = await prisma.todo.findUniqueOrThrow({
      where: { id: todo.id },
    });
    return NextResponse.json({ ok: true, todo: refreshed });
  } catch (error) {
    log("ERROR", "api.todos", "create failed", undefined, error);
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan tugas" },
      { status: 500 },
    );
  }
}
