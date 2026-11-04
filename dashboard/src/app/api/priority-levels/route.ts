export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { compileAndStore } from "@/lib/prompt/compiler";

const createSchema = z.object({
  label: z.string().trim().min(1).max(50),
  description: z.string().trim().max(2000).nullable().optional(),
  rule_text: z.string().trim().min(1).max(2000),
  color: z.string().trim().max(20).nullable().optional(),
});

export async function GET() {
  const levels = await prisma.priorityLevel.findMany({
    orderBy: { rank: "asc" },
  });
  return NextResponse.json({ ok: true, levels });
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      const highest = await tx.priorityLevel.findFirst({
        orderBy: { rank: "desc" },
      });
      const level = await tx.priorityLevel.create({
        data: {
          rank: (highest?.rank ?? 0) + 1,
          label: parsed.data.label,
          description: parsed.data.description ?? null,
          rule_text: parsed.data.rule_text,
          color: parsed.data.color ?? null,
        },
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
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { ok: false, error: "rank bentrok, coba lagi" },
        { status: 409 },
      );
    }
    log("ERROR", "api.priority-levels", "create failed", undefined, error);
    return NextResponse.json(
      { ok: false, error: "Gagal menambah tingkat prioritas" },
      { status: 500 },
    );
  }
}
