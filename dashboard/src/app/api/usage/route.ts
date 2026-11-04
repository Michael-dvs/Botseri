import { NextResponse } from "next/server";
import { format } from "date-fns";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { parseDaysParam, usageDateCutoff } from "@/lib/analytics/helpers";

export const dynamic = "force-dynamic";

type RawUsageRow = {
  day: Date | string;
  call_type: string;
  calls: bigint;
  prompt_tokens: bigint;
  completion_tokens: bigint;
  cost_usd: string;
  errors: bigint;
};

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

    const cutoffUtc = usageDateCutoff(new Date(), timezone, days);

    const rows = await prisma.$queryRaw<RawUsageRow[]>`
      SELECT
        date_trunc('day', ts AT TIME ZONE ${timezone})::date AS day,
        call_type,
        COUNT(*)::bigint AS calls,
        COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
        COALESCE(SUM(cost_usd), 0)::text AS cost_usd,
        COUNT(*) FILTER (WHERE success = false)::bigint AS errors
      FROM llm_usage_logs
      WHERE ts >= ${cutoffUtc}
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2 ASC
    `;

    const usage = rows.map((row) => {
      const dayStr =
        row.day instanceof Date
          ? format(row.day, "yyyy-MM-dd")
          : String(row.day).slice(0, 10);

      return {
        day: dayStr,
        call_type: row.call_type,
        calls: Number(row.calls),
        prompt_tokens: Number(row.prompt_tokens),
        completion_tokens: Number(row.completion_tokens),
        cost_usd: Number(row.cost_usd),
        errors: Number(row.errors),
      };
    });

    const totals = usage.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        prompt_tokens: acc.prompt_tokens + row.prompt_tokens,
        completion_tokens: acc.completion_tokens + row.completion_tokens,
        cost_usd: acc.cost_usd + row.cost_usd,
        errors: acc.errors + row.errors,
      }),
      { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, errors: 0 },
    );

    return NextResponse.json({
      ok: true,
      days,
      usage,
      totals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    await recordEvent("ERROR", "analytics", "usage_route_failed", { message });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
