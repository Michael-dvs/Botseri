export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { OrderStatus, Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { id as localeId } from "date-fns/locale";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { dateOnlyString, localDateString, localIsoString } from "@/lib/time";

type Row = {
  id: string;
  title: string;
  priority_rank: number;
  priority_label: string | null;
  due_at: Date | null;
  planned_date: Date;
  status: string;
  rollover_count: number;
};

export type PrioritizedTodoItem = {
  id: string;
  title: string;
  priority_rank: number;
  priority_label: string | null;
  due_at: string | null;
  planned_date: string;
  status: string;
  hanging: boolean;
};

async function handleGetPrioritizedTodos(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: Record<string, unknown> = {};

  if (request.method === "POST") {
    try {
      const parsed = await request.json();
      if (typeof parsed === "string") {
        rawBody = JSON.parse(parsed);
      } else if (parsed && typeof parsed === "object") {
        rawBody = parsed as Record<string, unknown>;
      }
    } catch {
      rawBody = {};
    }
  } else if (request.method === "GET") {
    try {
      const url = new URL(request.url);
      const scopeParam = url.searchParams.get("scope");
      const limitParam = url.searchParams.get("limit");
      if (scopeParam) rawBody.scope = scopeParam;
      if (limitParam) rawBody.limit = limitParam;
    } catch {
      rawBody = {};
    }
  }

  // Coerce scope: default to ALL_ACTIVE if not specified or if empty
  let scope: "TODAY" | "ALL_ACTIVE" | "OVERDUE" = "ALL_ACTIVE";
  if (typeof rawBody.scope === "string") {
    const upper = rawBody.scope.trim().toUpperCase();
    if (upper === "TODAY" || upper === "ALL_ACTIVE" || upper === "OVERDUE") {
      scope = upper;
    }
  }

  // Coerce limit
  let limit = 30;
  if (rawBody.limit !== undefined && rawBody.limit !== null) {
    const parsedLimit = Number(rawBody.limit);
    if (!isNaN(parsedLimit) && parsedLimit >= 1) {
      limit = Math.min(100, Math.floor(parsedLimit));
    }
  }

  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });
  const today = localDateString(new Date(), settings.timezone);
  const startOfDayWib = fromZonedTime(`${today}T00:00:00`, settings.timezone);

  const scopeSql =
    scope === "TODAY"
      ? Prisma.sql`AND planned_date <= ${today}::date`
      : scope === "OVERDUE"
        ? Prisma.sql`AND planned_date < ${today}::date`
        : Prisma.empty;

  const [rows, upcoming, activeCount, upcomingOrders] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT id, title, priority_rank, priority_label, due_at, planned_date, status, rollover_count
      FROM v_active_todos
      WHERE true ${scopeSql}
      ORDER BY priority_rank ASC, due_at ASC NULLS LAST, created_at ASC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Row[]>`
      SELECT id, title, priority_rank, priority_label, due_at, planned_date, status, rollover_count
      FROM v_active_todos
      WHERE planned_date > ${today}::date
      ORDER BY priority_rank ASC, due_at ASC NULLS LAST, created_at ASC
      LIMIT ${limit}
    `,
    prisma.todo.count({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
    }),
    prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS],
        },
        event_date: {
          gte: startOfDayWib,
        },
      },
      orderBy: [
        { event_date: "asc" },
        { created_at: "desc" },
      ],
      take: 5,
    }),
  ]);

  const mapRow = (row: Row) => ({
    id: row.id,
    title: row.title,
    priority_rank: row.priority_rank,
    priority_label: row.priority_label,
    due_at: row.due_at ? localIsoString(row.due_at, settings.timezone) : null,
    planned_date: dateOnlyString(row.planned_date),
    status: row.status,
    hanging: row.rollover_count >= 3,
  });

  const mapped = rows.map(mapRow);
  const mappedUpcoming = upcoming.map(mapRow);

  let topFocusRows: PrioritizedTodoItem[] = [];
  let remainingRows: PrioritizedTodoItem[] = [];

  if (scope === "TODAY") {
    if (mapped.length > 0) {
      topFocusRows = mapped.slice(0, 3);
      remainingRows = [...mapped.slice(3), ...mappedUpcoming];
    } else {
      topFocusRows = mappedUpcoming.slice(0, 3);
      remainingRows = mappedUpcoming.slice(3);
    }
  } else {
    topFocusRows = mapped.slice(0, 3);
    remainingRows = mapped.slice(3);
  }

  const mappedOrders = (upcomingOrders || []).map((o) => ({
    order_id: `#ORD-${o.id.slice(0, 8).toUpperCase()}`,
    customer_name: o.customer_name,
    service_type: o.description,
    event_date: o.event_date
      ? formatInTimeZone(o.event_date, settings.timezone, "d MMMM yyyy", { locale: localeId })
      : "-",
    delivery_address: o.delivery_address || "-",
    payment_status: o.payment_status,
  }));

  const responsePayload: Record<string, unknown> = {
    ok: true,
    top_focus: topFocusRows,
    remaining_todos: remainingRows,
    focus: topFocusRows,
    rest: remainingRows,
    upcoming: mappedUpcoming,
    upcoming_orders: mappedOrders,
    total_active: activeCount,
    total_upcoming_orders: mappedOrders.length,
    counts: {
      top_focus: topFocusRows.length,
      remaining_todos: remainingRows.length,
      focus: topFocusRows.length,
      rest: remainingRows.length,
      upcoming: mappedUpcoming.length,
      upcoming_orders: mappedOrders.length,
      total_active: activeCount,
    },
  };

  if (activeCount === 0) {
    responsePayload.message = "Tidak ada tugas aktif atau pending saat ini.";
  }

  return NextResponse.json(responsePayload);
}

export async function POST(request: Request) {
  return handleGetPrioritizedTodos(request);
}

export async function GET(request: Request) {
  return handleGetPrioritizedTodos(request);
}
