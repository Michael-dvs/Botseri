import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { localIsoString } from "@/lib/time";
import { renderPrompt } from "@/lib/prompt/render";
import { NON_LATIN_SCRIPT_REGEX, REPEATED_CHAR_REGEX } from "@/lib/waha/guard";

function sanitizeHistoryText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/(['"])\1{3,}/g, "$1$1")
    .slice(0, 1000)
    .trim();
}

function isGarbledHistory(text: string): boolean {
  if (!text) return true;
  if (NON_LATIN_SCRIPT_REGEX.test(text)) return true;
  if (REPEATED_CHAR_REGEX.test(text)) return true;
  if (/('{3,}|"{3,})/.test(text)) return true;
  return false;
}

type ActiveTodo = {
  id: string;
  title: string;
  status: string;
  priority_rank: number | null;
  priority_label: string | null;
  planned_date: Date | null;
};

export async function GET(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messageId = new URL(request.url).searchParams.get("message_id") ?? "";
  if (!z.string().uuid().safeParse(messageId).success) {
    return NextResponse.json({ error: "message_id tidak valid" }, { status: 400 });
  }

  const [message, settings, llm] = await Promise.all([
    prisma.messageLog.findUnique({ where: { id: messageId } }),
    prisma.botSettings.findUnique({ where: { id: 1 } }),
    prisma.llmConfig.findFirst({ where: { is_active: true } }),
  ]);
  if (!message) {
    return NextResponse.json({ error: "Pesan tidak ditemukan" }, { status: 404 });
  }
  if (!settings?.compiled_prompt || !llm) {
    return NextResponse.json(
      { error: "Bot belum siap" },
      { status: 404 },
    );
  }

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const [activeTodos, recent, untimedRecent] = await Promise.all([
    prisma.$queryRaw<ActiveTodo[]>`
      SELECT t.id, t.title, t.status,
             p.rank AS priority_rank, p.label AS priority_label,
             t.planned_date
      FROM todos t
      LEFT JOIN priority_levels p ON p.id = t.priority_level_id
      WHERE t.status IN ('PENDING', 'IN_PROGRESS')
      ORDER BY p.rank ASC NULLS LAST, t.created_at ASC
    `,
    prisma.messageLog.findMany({
      where: { chat_id: message.chat_id },
      orderBy: { created_at: "desc" },
      take: 15,
    }),
    prisma.todo.findMany({
      where: {
        status: "PENDING",
        has_specific_time: false,
        created_via: "CHAT",
        created_at: { gte: thirtyMinutesAgo },
      },
      select: {
        id: true,
        title: true,
        planned_date: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" },
      take: 3,
    }),
  ]);

  // Filter poisoned / duplicate history
  const rawChronological = recent.reverse();
  const cleanHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of rawChronological) {
    const rawText = item.body ?? item.transcript ?? "";
    if (item.direction === "OUTBOUND" && isGarbledHistory(rawText)) {
      // Exclude poisoned or gibberish assistant message
      continue;
    }
    const sanitized = sanitizeHistoryText(rawText);
    if (!sanitized) continue;

    // Deduplicate consecutive identical messages
    const last = cleanHistory[cleanHistory.length - 1];
    if (last && last.role === (item.direction === "INBOUND" ? "user" : "assistant") && last.content === sanitized) {
      continue;
    }

    cleanHistory.push({
      role: item.direction === "INBOUND" ? "user" : "assistant",
      content: sanitized,
    });
  }

  // Keep last 6 clean messages for context
  const history = cleanHistory.slice(-6);

  const systemPrompt = renderPrompt(settings.compiled_prompt, "CHAT_MASUK", {
    current_datetime: localIsoString(new Date(), settings.timezone),
    trigger_type: "CHAT_MASUK",
    active_todos: activeTodos.map((todo) => ({
      ...todo,
      planned_date: todo.planned_date
        ? todo.planned_date.toISOString().slice(0, 10)
        : null,
    })),
    untimed_recent_todos: untimedRecent.map((t) => ({
      id: t.id,
      title: t.title,
      planned_date: t.planned_date.toISOString().slice(0, 10),
    })),
    daily_stats: null,
    calendar_events_today: [],
    recent_messages: history,
  });

  return NextResponse.json({
    system_prompt: systemPrompt,
    history,
    model: "botseri-default",
    timezone: settings.timezone,
  });
}
