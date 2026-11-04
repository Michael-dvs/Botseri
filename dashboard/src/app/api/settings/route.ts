export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { compileAndStore } from "@/lib/prompt/compiler";

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "format jam harus HH:MM");

const schema = z.object({
  brand_name: z.string().trim().min(1).max(100),
  business_type: z.string().trim().min(1).max(100),
  owner_name: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(50),
  work_hours_start: time,
  work_hours_end: time,
  early_brief_time: time,
  working_days: z.array(z.number().int().min(1).max(7)).min(1),
  behavior_mode: z.enum(["STRICT", "SANTAI"]),
  behavior_instruction: z.string().max(4000).nullable(),
  reminder_interval_minutes: z.number().int().min(0).max(1440),
  reminder_max_per_day: z.number().int().min(0).max(24),
  reminder_max_rank: z.number().int().min(1).max(99),
  brief_window_minutes: z.number().int().min(5).max(720),
  eod_window_minutes: z.number().int().min(5).max(720),
  default_due_time: time,
  google_sync_mode: z.enum(["AUTO", "BOTH"]),
  enable_orders: z.boolean().optional(),
  bot_enabled: z.boolean(),
});

export async function GET() {
  const [settings, holidays] = await Promise.all([
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
  ]);
  return NextResponse.json({
    ok: true,
    settings,
    holidays: holidays.map((holiday) => ({
      date: holiday.date.toISOString().slice(0, 10),
      label: holiday.label,
    })),
  });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const compiled = await prisma.$transaction(async (tx) => {
      const settings = await tx.botSettings.update({
        where: { id: 1 },
        data: parsed.data,
      });
      return compileAndStore(tx, settings);
    });
    return NextResponse.json({ ok: true, warnings: compiled.warnings });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Gagal menyimpan",
      },
      { status: 500 },
    );
  }
}
