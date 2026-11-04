export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { listOrdersSegmented, type FormattedOrderSummary } from "@/lib/orders/service";

export type { FormattedOrderSummary };

async function handleGetOrders(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.botSettings.findUnique({
    where: { id: 1 },
    select: { timezone: true },
  });
  const tz = settings?.timezone || "Asia/Jakarta";
  const now = new Date();

  const segmented = await listOrdersSegmented(now, tz);

  const responsePayload: Record<string, unknown> = {
    ok: true,
    today_count: segmented.today_orders.length,
    upcoming_count: segmented.upcoming_orders.length,
    total_active: segmented.total_active,
    orders_today: segmented.today_orders,
    upcoming_orders: segmented.upcoming_orders,
    orders: segmented.all_formatted,
    total_orders: segmented.total_active,
  };

  if (segmented.total_active === 0) {
    responsePayload.message = "Belum ada pesanan pelanggan yang tercatat di sistem.";
  }

  return NextResponse.json(responsePayload);
}

export async function POST(request: Request) {
  return handleGetOrders(request);
}

export async function GET(request: Request) {
  return handleGetOrders(request);
}
