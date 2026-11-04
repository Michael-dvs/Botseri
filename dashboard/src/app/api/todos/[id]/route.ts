export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { localDateString } from "@/lib/time";
import { removeGoogleObjects, syncTodo } from "@/lib/google/sync";

const uuidSchema = z.string().uuid();

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  priority_rank: z.number().int().min(1).optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  has_specific_time: z.boolean().optional(),
  planned_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }

  const parsed = updateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const existing = await prisma.todo.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }

  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });

  let priorityLevelId = existing.priority_level_id;
  let priorityRank = existing.priority_rank;
  if (input.priority_rank !== undefined) {
    const level = await prisma.priorityLevel.findUnique({
      where: { rank: input.priority_rank },
    });
    if (!level) {
      return NextResponse.json(
        { ok: false, error: "priority_rank tidak ada" },
        { status: 400 },
      );
    }
    priorityLevelId = level.id;
    priorityRank = level.rank;
  }

  const dueAt =
    input.due_at === undefined
      ? existing.due_at
      : input.due_at === null
        ? null
        : new Date(input.due_at);

  let plannedDate = existing.planned_date;
  if (input.planned_date !== undefined) {
    plannedDate = new Date(`${input.planned_date}T00:00:00Z`);
    if (Number.isNaN(plannedDate.getTime())) {
      return NextResponse.json(
        { ok: false, error: "planned_date tidak valid" },
        { status: 400 },
      );
    }
  } else if (input.due_at !== undefined && dueAt) {
    plannedDate = new Date(
      `${localDateString(dueAt, settings.timezone)}T00:00:00Z`,
    );
  }

  const status = input.status ?? existing.status;
  const completedAt =
    status === "DONE" ? existing.completed_at ?? new Date() : null;

  try {
    const todo = await prisma.todo.update({
      where: { id: params.id },
      data: {
        title: input.title ?? existing.title,
        description:
          input.description === undefined
            ? existing.description
            : input.description,
        category:
          input.category === undefined ? existing.category : input.category,
        status,
        completed_at: completedAt,
        priority_level_id: priorityLevelId,
        priority_rank: priorityRank,
        due_at: dueAt,
        has_specific_time:
          input.has_specific_time ?? existing.has_specific_time,
        planned_date: plannedDate,
        google_sync_status:
          existing.google_sync_status === "NOT_REQUIRED"
            ? "NOT_REQUIRED"
            : "PENDING",
      },
    });
    await syncTodo(todo.id);
    const refreshed = await prisma.todo.findUniqueOrThrow({
      where: { id: todo.id },
    });
    return NextResponse.json({ ok: true, todo: refreshed });
  } catch (error) {
    log("ERROR", "api.todos", "update failed", { id: params.id }, error);
    return NextResponse.json(
      { ok: false, error: "Gagal memperbarui tugas" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }

  const [todo, oauth] = await Promise.all([
    prisma.todo.findUnique({ where: { id: params.id } }),
    prisma.oAuthToken.findFirst({ where: { provider: "google" } }),
  ]);
  if (!todo) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }
  await removeGoogleObjects(todo, oauth);
  await prisma.todo.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
