export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { fuzzyMatch } from "@/lib/todos";
import { syncTodo } from "@/lib/google/sync";
import { localIsoString } from "@/lib/time";

const schema = z
  .object({
    todo_id: z.string().uuid().optional(),
    match_text: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"]),
  })
  .refine((value) => Boolean(value.todo_id || value.match_text), {
    message: "todo_id atau match_text wajib diisi",
  });

function domainError(code: string, message: string, candidates?: unknown) {
  return NextResponse.json({
    ok: false,
    error: { code, message, candidates },
  });
}

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

  if (typeof rawBody.status === "string") {
    rawBody.status = rawBody.status.trim().toUpperCase();
  }
  if (rawBody.todo_id === null) delete rawBody.todo_id;
  if (rawBody.match_text === null) delete rawBody.match_text;

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const input = parsed.data;

  let todoId = input.todo_id ?? null;

  if (!todoId && input.match_text) {
    const active = await prisma.todo.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true, title: true },
      take: 100,
    });
    const result = fuzzyMatch(input.match_text, active);
    if (result.matches.length === 0) {
      return domainError("NOT_FOUND", "Tidak ada tugas aktif yang cocok.");
    }
    if (result.ambiguous) {
      return domainError(
        "AMBIGUOUS",
        "Ditemukan lebih dari 1 tugas serupa. Tolong tanyakan konfirmasi ke pengguna.",
        result.matches
          .slice(0, 5)
          .map((item) => ({ id: item.id, title: item.title })),
      );
    }
    todoId = result.matches[0].id;
  }

  if (!todoId) {
    return domainError("NOT_FOUND", "Tugas tidak ditemukan.");
  }

  const todo = await prisma.todo.findUnique({ where: { id: todoId } });
  if (!todo) return domainError("NOT_FOUND", "Tugas tidak ditemukan.");

  const updated = await prisma.todo.update({
    where: { id: todo.id },
    data: {
      status: input.status,
      completed_at: input.status === "DONE" ? new Date() : null,
    },
  });

  await syncTodo(updated.id);

  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });

  return NextResponse.json({
    ok: true,
    todo: {
      id: updated.id,
      title: updated.title,
      status: updated.status,
      completed_at: updated.completed_at
        ? localIsoString(updated.completed_at, settings.timezone)
        : null,
    },
  });
}
