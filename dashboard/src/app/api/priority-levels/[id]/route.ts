export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { compileAndStore } from "@/lib/prompt/compiler";

const uuidSchema = z.string().uuid();

const updateSchema = z.object({
  label: z.string().trim().min(1).max(50).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  rule_text: z.string().trim().min(1).max(2000).optional(),
  color: z.string().trim().max(20).nullable().optional(),
});

const deleteSchema = z.object({
  move_to_rank: z.number().int().min(1).optional(),
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      const level = await tx.priorityLevel.update({
        where: { id: params.id },
        data: parsed.data,
      });
      const settings = await tx.botSettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      const compiled = await compileAndStore(tx, settings);
      return { level, warnings: compiled.warnings };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { ok: false, error: "tidak ditemukan" },
        { status: 404 },
      );
    }
    log(
      "ERROR",
      "api.priority-levels",
      "update failed",
      { id: params.id },
      error,
    );
    return NextResponse.json(
      { ok: false, error: "Gagal memperbarui tingkat prioritas" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }

  const parsed = deleteSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "payload tidak valid" },
      { status: 400 },
    );
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const level = await tx.priorityLevel.findUnique({
        where: { id: params.id },
      });
      if (!level) return { status: 404 as const };

      const todoCount = await tx.todo.count({
        where: { priority_level_id: params.id },
      });
      if (todoCount > 0 && parsed.data.move_to_rank === undefined) {
        return { status: 409 as const, todoCount };
      }

      if (todoCount > 0) {
        const target = await tx.priorityLevel.findUnique({
          where: { rank: parsed.data.move_to_rank },
        });
        if (!target || target.id === params.id) {
          return { status: 400 as const };
        }
        await tx.todo.updateMany({
          where: { priority_level_id: params.id },
          data: {
            priority_level_id: target.id,
            priority_rank: target.rank,
          },
        });
      }

      await tx.priorityLevel.delete({ where: { id: params.id } });
      const settings = await tx.botSettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      const compiled = await compileAndStore(tx, settings);
      return { status: 200 as const, warnings: compiled.warnings };
    });

    if (outcome.status === 404) {
      return NextResponse.json(
        { ok: false, error: "tidak ditemukan" },
        { status: 404 },
      );
    }
    if (outcome.status === 400) {
      return NextResponse.json(
        { ok: false, error: "move_to_rank tidak valid" },
        { status: 400 },
      );
    }
    if (outcome.status === 409) {
      return NextResponse.json(
        {
          ok: false,
          error: "pindahkan to-do ke tingkat lain terlebih dahulu",
          todo_count: outcome.todoCount,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, warnings: outcome.warnings });
  } catch (error) {
    log(
      "ERROR",
      "api.priority-levels",
      "delete failed",
      { id: params.id },
      error,
    );
    return NextResponse.json(
      { ok: false, error: "Gagal menghapus tingkat prioritas" },
      { status: 500 },
    );
  }
}
