import { NextResponse } from "next/server";
import { addDays, format } from "date-fns";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { dateOnlyToDate, localDateString } from "@/lib/time";
import { parseDaysParam, summarizeStats, safeDecimal } from "@/lib/analytics/helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const parsedDays = parseDaysParam(url.searchParams.get("days"));
    if (!parsedDays.ok) {
      return NextResponse.json({ ok: false, error: parsedDays.error }, { status: 400 });
    }
    const days = parsedDays.days;

    const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
    const timezone = settings?.timezone ?? "Asia/Jakarta";

    const now = new Date();
    const todayStr = localDateString(now, timezone);
    const anchor = new Date(`${todayStr}T00:00:00Z`);
    const earliestDateStr = format(addDays(anchor, -(days - 1)), "yyyy-MM-dd");
    const cutoffDate = dateOnlyToDate(earliestDateStr);

    const rows = await prisma.dailyStat.findMany({
      where: {
        local_date: {
          gte: cutoffDate,
        },
      },
      orderBy: { local_date: "desc" },
    });

    const stats = rows.map((row) => ({
      local_date: format(row.local_date, "yyyy-MM-dd"),
      target_count: row.target_count,
      done_count: row.done_count,
      pending_count: row.pending_count,
      completion_rate: row.completion_rate !== null ? safeDecimal(row.completion_rate) : null,
      tier: row.tier,
      rolled_over_count: row.rolled_over_count,
    }));

    const summary = summarizeStats(stats);

    return NextResponse.json({
      ok: true,
      days,
      stats,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    await recordEvent("ERROR", "analytics", "stats_route_failed", { message });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
