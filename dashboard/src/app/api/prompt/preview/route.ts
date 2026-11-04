export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { compileSystemPrompt } from "@/lib/prompt/compiler";
import { renderPrompt } from "@/lib/prompt/render";
import { localDateString, localIsoString } from "@/lib/time";

const schema = z.object({
  trigger_type: z.enum([
    "CHAT_MASUK",
    "MORNING_BRIEF",
    "WORK_HOURS_REMINDER",
    "END_OF_DAY_EVAL",
  ]),
  custom_prompt_template: z.string().max(40000).nullable().optional(),
  prompt_mode: z.enum(["STACK", "CUSTOM"]).optional(),
});

type FocusRow = {
  id: string;
  title: string;
  priority_rank: number;
  priority_label: string | null;
  due_at: Date | null;
  planned_date: Date;
  status: string;
};

export async function POST(request: Request) {
  const parsed = schema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "payload tidak valid" },
      { status: 400 },
    );
  }

  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });
  const mode = parsed.data.prompt_mode ?? settings.prompt_mode;
  const template =
    parsed.data.custom_prompt_template === undefined
      ? settings.custom_prompt_template
      : parsed.data.custom_prompt_template;
  if (mode === "CUSTOM" && !template?.trim()) {
    return NextResponse.json(
      { ok: false, error: "template CUSTOM wajib diisi" },
      { status: 400 },
    );
  }

  const levels = await prisma.priorityLevel.findMany({
    orderBy: { rank: "asc" },
  });

  let compiled;
  try {
    compiled = compileSystemPrompt(
      {
        ...settings,
        prompt_mode: mode,
        custom_prompt_template: template ?? null,
      },
      levels,
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "kompilasi gagal",
      },
      { status: 400 },
    );
  }

  const today = localDateString(new Date(), settings.timezone);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const [rows, target, done] = await Promise.all([
    prisma.$queryRaw<FocusRow[]>`
      SELECT id, title, priority_rank, priority_label, due_at, planned_date, status
      FROM v_active_todos
      LIMIT 5
    `,
    prisma.todo.count({
      where: { planned_date: todayDate, status: { not: "CANCELLED" } },
    }),
    prisma.todo.count({
      where: { planned_date: todayDate, status: "DONE" },
    }),
  ]);

  const completionRate =
    target > 0 ? Math.round((done / target) * 100) : 0;
  const tier =
    target === 0
      ? "NO_TASKS"
      : completionRate >= 70
        ? "HIGH"
        : completionRate >= 40
          ? "MID"
          : "LOW";

  const sampleContext = {
    current_datetime: localIsoString(new Date(), settings.timezone),
    trigger_type: parsed.data.trigger_type,
    active_todos: rows.map((row) => ({
      id: row.id,
      title: row.title,
      priority_rank: row.priority_rank,
      priority_label: row.priority_label,
      due_at: row.due_at
        ? localIsoString(row.due_at, settings.timezone)
        : null,
      planned_date: row.planned_date.toISOString().slice(0, 10),
      status: row.status,
    })),
    daily_stats: {
      target_count: target,
      done_count: done,
      pending_count: Math.max(target - done, 0),
      completion_rate: completionRate,
      tier,
    },
    calendar_events_today: [],
    recent_messages: [],
  };

  try {
    const prompt = renderPrompt(
      compiled.prompt,
      parsed.data.trigger_type,
      sampleContext,
    );
    return NextResponse.json({
      ok: true,
      prompt,
      warnings: compiled.warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "render gagal",
      },
      { status: 400 },
    );
  }
}
