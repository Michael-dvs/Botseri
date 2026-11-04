export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  date: z.string().regex(datePattern),
  label: z.string().trim().min(1).max(100),
});

export async function GET() {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  return NextResponse.json({
    ok: true,
    holidays: holidays.map((holiday) => ({
      date: holiday.date.toISOString().slice(0, 10),
      label: holiday.label,
    })),
  });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const date = new Date(`${parsed.data.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json(
      { ok: false, error: "tanggal tidak valid" },
      { status: 400 },
    );
  }
  const holiday = await prisma.holiday.upsert({
    where: { date },
    update: { label: parsed.data.label },
    create: { date, label: parsed.data.label },
  });
  return NextResponse.json({
    ok: true,
    holiday: {
      date: holiday.date.toISOString().slice(0, 10),
      label: holiday.label,
    },
  });
}

export async function DELETE(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !datePattern.test(date)) {
    return NextResponse.json(
      { ok: false, error: "date wajib berformat YYYY-MM-DD" },
      { status: 400 },
    );
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return NextResponse.json(
      { ok: false, error: "tanggal tidak valid" },
      { status: 400 },
    );
  }
  await prisma.holiday.deleteMany({ where: { date: parsed } });
  return NextResponse.json({ ok: true });
}
