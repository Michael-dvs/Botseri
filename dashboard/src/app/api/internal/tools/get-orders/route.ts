export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { id as localeId } from "date-fns/locale";
import { OrderPaymentStatus, OrderStatus, type Order } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { localDayUtcBounds } from "@/lib/time";

export interface FormattedOrderSummary {
  order_id: string;
  customer_name: string;
  customer_contact: string;
  service_type: string;
  event_date: string;
  event_date_formatted: string;
  delivery_time: string;
  delivery_address: string;
  operational_status: string;
  status: string;
  payment_status: string;
  special_notes: string;
}

function extractOrderDetails(notes: string | null) {
  let delivery_time = "-";
  let special_notes = notes || "-";

  if (notes) {
    const jamMatch = notes.match(/Jam Pengiriman:\s*([^|]+)/i);
    if (jamMatch) {
      delivery_time = jamMatch[1].trim();
    }
    const reqMatch = notes.match(/Request Khusus:\s*(.+)/i);
    if (reqMatch) {
      special_notes = reqMatch[1].trim();
    } else if (jamMatch) {
      const remaining = notes.replace(/Jam Pengiriman:\s*[^|]+(\|)?/i, "").trim();
      special_notes = remaining || "-";
    }
  }

  return { delivery_time, special_notes };
}

function formatPaymentStatus(status: OrderPaymentStatus): string {
  if (status === OrderPaymentStatus.UNPAID) return "UNPAID (Belum bayar)";
  if (status === OrderPaymentStatus.DP_PAID) return "DP_PAID (Sudah DP)";
  if (status === OrderPaymentStatus.PAID) return "PAID (Lunas)";
  return String(status);
}

function formatOperationalStatus(status: OrderStatus): string {
  if (status === OrderStatus.PENDING) return "PENDING (Belum dikirim)";
  if (status === OrderStatus.IN_PROGRESS) return "IN_PROGRESS (Sedang dikerjakan)";
  if (status === OrderStatus.COMPLETED) return "COMPLETED (Selesai)";
  if (status === OrderStatus.CANCELLED) return "CANCELLED (Dibatalkan)";
  return String(status);
}

function formatOrder(order: Order, tz: string): FormattedOrderSummary {
  const shortId = `#ORD-${order.id.slice(0, 8).toUpperCase()}`;
  const formattedDate = order.event_date
    ? formatInTimeZone(order.event_date, tz, "d MMMM yyyy", { locale: localeId })
    : "-";

  const { delivery_time, special_notes } = extractOrderDetails(order.notes);

  let finalDeliveryTime = delivery_time;
  if (finalDeliveryTime === "-" && order.event_date) {
    const timePart = formatInTimeZone(order.event_date, tz, "HH:mm");
    if (timePart !== "00:00") {
      finalDeliveryTime = `${timePart} WIB`;
    }
  }

  const opStatus = formatOperationalStatus(order.status);
  const payStatus = formatPaymentStatus(order.payment_status);

  return {
    order_id: shortId,
    customer_name: order.customer_name,
    customer_contact: order.customer_contact || "-",
    service_type: order.description,
    event_date: formattedDate,
    event_date_formatted: formattedDate,
    delivery_time: finalDeliveryTime,
    delivery_address: order.delivery_address || "-",
    operational_status: opStatus,
    status: opStatus,
    payment_status: payStatus,
    special_notes: special_notes,
  };
}

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
  const { start: todayStart, end: todayEnd } = localDayUtcBounds(now, tz);

  // Active operational statuses
  const activeOpStatuses = [OrderStatus.PENDING, OrderStatus.IN_PROGRESS];

  const [ordersTodayRaw, upcomingOrdersRaw] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: { in: activeOpStatuses },
        event_date: {
          gte: todayStart,
          lt: todayEnd,
        },
      },
      orderBy: [
        { event_date: "asc" },
        { created_at: "desc" },
      ],
    }),
    prisma.order.findMany({
      where: {
        status: { in: activeOpStatuses },
        OR: [
          { event_date: { gte: todayEnd } },
          { event_date: null },
        ],
      },
      orderBy: [
        { event_date: "asc" },
        { created_at: "desc" },
      ],
      take: 10,
    }),
  ]);

  const ordersToday = ordersTodayRaw.map((o) => formatOrder(o, tz));
  const upcomingOrders = upcomingOrdersRaw.map((o) => formatOrder(o, tz));
  const allFormatted = [...ordersToday, ...upcomingOrders];
  const totalActive = allFormatted.length;

  const responsePayload: Record<string, unknown> = {
    ok: true,
    today_count: ordersToday.length,
    upcoming_count: upcomingOrders.length,
    total_active: totalActive,
    orders_today: ordersToday,
    upcoming_orders: upcomingOrders,
    orders: allFormatted,
    total_orders: totalActive,
  };

  if (totalActive === 0) {
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
