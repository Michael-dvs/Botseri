export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { compileAndStore } from "@/lib/prompt/compiler";

const schema = z.object({
  order: z.array(z.string().uuid()).min(1),
});

export async function PUT(request: Request) {
  const parsed = schema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "payload tidak valid" },
      { status: 400 },
    );
  }

  const existing = await prisma.priorityLevel.findMany();
  const requested = parsed.data.order;
  const existingIds = new Set(existing.map((level) => level.id));
  if (
    existing.length !== requested.length ||
    new Set(requested).size !== requested.length ||
    requested.some((id) => !existingIds.has(id))
  ) {
    return NextResponse.json(
      { ok: false, error: "daftar tidak lengkap" },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Phase 1: negative temporary ranks avoid unique(rank) collisions.
      for (let index = 0; index < requested.length; index++) {
        await tx.priorityLevel.update({
          where: { id: requested[index] },
          data: { rank: -(index + 1) },
        });
      }
      // Phase 2: final ranks and denormalized todo ranks.
      for (let index = 0; index < requested.length; index++) {
        await tx.priorityLevel.update({
          where: { id: requested[index] },
          data: { rank: index + 1 },
        });
      }
      const levels = await tx.priorityLevel.findMany({
        orderBy: { rank: "asc" },
      });
      for (const level of levels) {
        await tx.todo.updateMany({
          where: { priority_level_id: level.id },
          data: { priority_rank: level.rank },
        });
      }
      const settings = await tx.botSettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      const compiled = await compileAndStore(tx, settings);
      return { warnings: compiled.warnings };
    });

    return NextResponse.json({ ok: true, warnings: result.warnings });
  } catch (error) {
    log("ERROR", "api.priority-levels", "reorder failed", undefined, error);
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan urutan prioritas" },
      { status: 500 },
    );
  }
}
