export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { formatDueAtLocalText, localDateString, localIsoString, normalizeIsoDateTime, resolveTimeExpression } from "@/lib/time";
import { syncTodo } from "@/lib/google/sync";

const schema = z.object({
  todo_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  remind_at: z.string().datetime({ offset: true }).nullable().optional(),
  has_specific_time: z.boolean().optional(),
  priority_rank: z.number().int().min(1).optional(),
});

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: Record<string, unknown> = {};
  try {
    const raw = await request.json();
    if (typeof raw === "string") {
      rawBody = JSON.parse(raw);
    } else if (raw && typeof raw === "object") {
      rawBody = raw as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_JSON", message: "Request body bukan JSON yang valid" } },
      { status: 422 },
    );
  }

  if (rawBody.priority_rank !== undefined && rawBody.priority_rank !== null) {
    const p = Number(rawBody.priority_rank);
    if (!isNaN(p)) rawBody.priority_rank = Math.floor(p);
  }
  if (typeof rawBody.has_specific_time === "string") {
    rawBody.has_specific_time = rawBody.has_specific_time === "true";
  }
  if (typeof rawBody.remind_at === "string") {
    try {
      rawBody.remind_at = normalizeIsoDateTime(rawBody.remind_at);
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "Format remind_at tidak valid", fields: ["remind_at"] } },
        { status: 422 },
      );
    }
  }
  if (typeof rawBody.due_at === "string") {
    try {
      rawBody.due_at = normalizeIsoDateTime(rawBody.due_at);
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "Format due_at tidak valid", fields: ["due_at"] } },
        { status: 422 },
      );
    }
  } else if (rawBody.time_expression || rawBody.daypart || rawBody.time_kind) {
    const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
    const tz = settings?.timezone ?? "Asia/Jakarta";
    const res = resolveTimeExpression(
      new Date(),
      tz,
      (rawBody.time_expression || rawBody) as Parameters<typeof resolveTimeExpression>[2],
      typeof rawBody.date_hint === "string" ? rawBody.date_hint : null,
    );
    if (res.ok) {
      if (rawBody.is_reminder || rawBody.remind_at !== undefined) {
        rawBody.remind_at = res.due_at_iso;
      } else {
        rawBody.due_at = res.due_at_iso;
      }
      rawBody.has_specific_time = true;
    }
  }
  if (rawBody.title === null) delete rawBody.title;
  if (rawBody.priority_rank === null) delete rawBody.priority_rank;
  if (rawBody.has_specific_time === null) delete rawBody.has_specific_time;

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const [todo, settings, level, oauth] = await Promise.all([
    prisma.todo.findUnique({ where: { id: input.todo_id } }),
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    input.priority_rank
      ? prisma.priorityLevel.findUnique({
          where: { rank: input.priority_rank },
        })
      : Promise.resolve(null),
    prisma.oAuthToken.findFirst({ where: { provider: "google" } }),
  ]);

  if (!todo) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "NOT_FOUND", message: "Tugas tidak ditemukan." },
      },
      { status: 200 },
    );
  }

  if (input.priority_rank && !level) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_RANK",
          message: "priority_rank tidak ada di Priority Stack.",
        },
      },
      { status: 200 },
    );
  }

  const dueAt =
    input.due_at === undefined
      ? todo.due_at
      : input.due_at === null
        ? null
        : new Date(input.due_at);

  const remindAt =
    input.remind_at === undefined
      ? (input.due_at !== undefined && input.due_at !== null && todo.remind_at === null
          ? new Date(new Date(input.due_at).getTime() - 60 * 60 * 1000)
          : todo.remind_at)
      : input.remind_at === null
        ? null
        : new Date(input.remind_at);

  const refDate = dueAt ?? remindAt;
  const plannedDate =
    refDate === null
      ? todo.planned_date
      : new Date(`${localDateString(refDate, settings.timezone)}T00:00:00Z`);

  const updated = await prisma.todo.update({
    where: { id: todo.id },
    data: {
      title: input.title,
      description: input.description,
      due_at: dueAt,
      remind_at: remindAt,
      has_specific_time: input.has_specific_time ?? (dueAt !== null || remindAt !== null),
      planned_date: plannedDate,
      priority_rank: level?.rank,
      priority_level_id: level?.id,
      google_sync_status:
        oauth?.status === "CONNECTED" ? "PENDING" : "NOT_REQUIRED",
      ...((dueAt && dueAt > new Date()) || (remindAt && remindAt > new Date())
        ? {
            reminded_at: null,
            reminder_claimed_at: null,
            reminder_attempts: 0,
          }
        : {}),
    },
  });

  try {
    await syncTodo(updated.id);
  } catch (err) {
    console.error("syncTodo error in update-todo:", err);
  }
  return NextResponse.json({
    ok: true,
    todo: {
      id: updated.id,
      title: updated.title,
      due_at: updated.due_at
        ? localIsoString(updated.due_at, settings.timezone)
        : null,
      due_at_local_text: updated.due_at
        ? formatDueAtLocalText(updated.due_at, settings.timezone)
        : null,
      remind_at: updated.remind_at
        ? localIsoString(updated.remind_at, settings.timezone)
        : null,
      remind_at_local_text: updated.remind_at
        ? formatDueAtLocalText(updated.remind_at, settings.timezone)
        : null,
      planned_date: updated.planned_date.toISOString().slice(0, 10),
      has_specific_time: updated.has_specific_time,
      priority_rank: updated.priority_rank,
      google_sync_status: updated.google_sync_status,
    },
  });
}
