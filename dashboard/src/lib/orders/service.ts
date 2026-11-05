import { OrderPaymentStatus, OrderStatus, type Order, type Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { id as localeId } from "date-fns/locale";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { unmuteCustomerSessionByOrder } from "@/lib/customer/session";
import { localDayUtcBounds } from "@/lib/time";
import { sanitizeUntrusted, wrapCustomerText, type UntrustedCustomerText } from "@/lib/security/untrusted";

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
  customer_text: UntrustedCustomerText;
}

export function extractOrderDetails(notes: string | null) {
  let delivery_time = "-";
  let special_notes = notes || "-";

  if (notes) {
    const timeMatch = notes.match(/Jam Pengiriman:\s*([^|]+)/i);
    if (timeMatch) delivery_time = timeMatch[1].trim();

    const requestMatch = notes.match(/Request Khusus:\s*([^|]+)/i);
    if (requestMatch) special_notes = requestMatch[1].trim();
    else if (!timeMatch) special_notes = notes;
    else special_notes = "-";
  }

  return { delivery_time, special_notes };
}

export function formatPaymentStatus(status: OrderPaymentStatus): string {
  if (status === OrderPaymentStatus.PAID) return "PAID (Lunas)";
  if (status === OrderPaymentStatus.DP_PAID) return "DP_PAID (Sudah DP)";
  return "UNPAID (Belum bayar)";
}

export function formatPaymentStatusText(status: OrderPaymentStatus): string {
  if (status === OrderPaymentStatus.PAID) return "Lunas";
  if (status === OrderPaymentStatus.DP_PAID) return "Sudah DP";
  return "Belum dibayar";
}

export function formatOperationalStatus(status: OrderStatus): string {
  if (status === OrderStatus.COMPLETED) return "SELESAI (Sudah dikerjakan/dikirim)";
  if (status === OrderStatus.IN_PROGRESS) return "IN_PROGRESS (Sedang dikerjakan)";
  if (status === OrderStatus.CANCELLED) return "CANCELLED (Dibatalkan)";
  return "PENDING (Belum dikirim)";
}

export function formatOperationalStatusText(status: OrderStatus): string {
  if (status === OrderStatus.COMPLETED) return "SELESAI dikerjakan/dikirim";
  if (status === OrderStatus.IN_PROGRESS) return "SEDANG DIKERJAKAN";
  if (status === OrderStatus.CANCELLED) return "DIBATALKAN";
  return "MENUNGGU pengerjaan/pengiriman";
}

export function formatOrder(order: Order, tz: string): FormattedOrderSummary {
  const { delivery_time, special_notes } = extractOrderDetails(order.notes);
  const rawNotes = special_notes === "-" ? "" : special_notes;
  const customerTextObj = wrapCustomerText(rawNotes || "-");

  return {
    order_id: `#ORD-${order.id.slice(0, 8).toUpperCase()}`,
    customer_name: sanitizeUntrusted(order.customer_name, { maxLen: 150 }),
    customer_contact: order.customer_contact || "-",
    service_type: sanitizeUntrusted(order.description, { maxLen: 200 }),
    event_date: order.event_date ? order.event_date.toISOString() : "-",
    event_date_formatted: order.event_date
      ? formatInTimeZone(order.event_date, tz, "d MMMM yyyy", { locale: localeId })
      : "-",
    delivery_time,
    delivery_address: sanitizeUntrusted(order.delivery_address || "-", { maxLen: 500 }),
    operational_status: formatOperationalStatus(order.status),
    status: order.status,
    payment_status: formatPaymentStatus(order.payment_status),
    special_notes: sanitizeUntrusted(special_notes, { maxLen: 500 }),
    customer_text: customerTextObj,
  };
}

/**
 * Mengambil data pesanan aktif terkini pelanggan jika ada.
 */
export async function getActiveOrderForCustomer(
  chatId: string,
  phoneE164?: string,
  excludeOrderId?: string,
): Promise<Order | null> {
  if (!chatId && !phoneE164) return null;
  if (typeof prisma.order?.findFirst !== "function") return null;

  const digits = (chatId || "").replace(/\D/g, "");
  const normalized = phoneE164 ?? (digits ? `+${digits}` : "");
  const targetChatId = chatId && chatId.includes("@") ? chatId : (digits ? `${digits}@c.us` : chatId);

  const order = await prisma.order.findFirst({
    where: {
      deleted_at: null,
      status: {
        in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS],
      },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      OR: [
        ...(targetChatId ? [{ customer_chat_id: targetChatId }] : []),
        ...(normalized ? [{ customer_chat_id: `${normalized.replace(/\D/g, "")}@c.us` }] : []),
        ...(normalized
          ? [
              {
                customer_chat_id: null,
                customer_contact: { in: [normalized, normalized.replace(/^\+/, "")] },
              },
            ]
          : []),
      ],
    },
    orderBy: { created_at: "desc" },
  });

  if (order && excludeOrderId && order.id === excludeOrderId) {
    return null;
  }
  return order;
}

/**
 * Memeriksa apakah pelanggan masih memiliki pesanan aktif yang belum selesai.
 */
export async function hasActiveOrder(
  chatId: string,
  phoneE164?: string,
  excludeOrderId?: string,
): Promise<boolean> {
  const active = await getActiveOrderForCustomer(chatId, phoneE164, excludeOrderId);
  return Boolean(active);
}

/**
 * Membuka kunci mute pelanggan jika tidak ada lagi pesanan aktif lain yang belum selesai.
 */
export async function releaseCustomerSession(
  chatId: string | null,
  excludeOrderId?: string,
): Promise<number> {
  if (!chatId || !chatId.trim()) return 0;
  const cleanChatId = chatId.trim();

  // Jika pelanggan masih memiliki pesanan aktif lain, jangan buka kunci mute
  const stillActive = await hasActiveOrder(cleanChatId, undefined, excludeOrderId);
  if (stillActive) {
    return 0;
  }

  return unmuteCustomerSessionByOrder({ customer_chat_id: cleanChatId, customer_contact: cleanChatId });
}

/**
 * Menyelesaikan pesanan secara atomik, opsi melunasi, dan melepas kunci sesi pelanggan jika relevan.
 */
async function runInTransaction<T>(fn: (tx: Prisma.TransactionClient | typeof prisma) => Promise<T>): Promise<T> {
  if (typeof prisma.$transaction === "function") {
    return prisma.$transaction(fn);
  }
  return fn(prisma);
}

export async function completeOrder(
  id: string,
  options?: { pay?: boolean; notes?: string | null; actor?: string },
): Promise<Order> {
  return runInTransaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Pesanan dengan ID ${id} tidak ditemukan.`);
    }

    const updated = await tx.order.update({
      where: { id },
      data: {
        status: OrderStatus.COMPLETED,
        completed_at: new Date(),
        ...(options?.pay ? { payment_status: OrderPaymentStatus.PAID } : {}),
        ...(options?.notes !== undefined ? { notes: options.notes } : {}),
      },
    });

    await releaseCustomerSession(existing.customer_chat_id || existing.customer_contact, id);

    await recordEvent("INFO", "ORDER_SERVICE", "ORDER_MUTATED", {
      action: "COMPLETE",
      order_id: id,
      actor: options?.actor || "system",
      payment_paid: Boolean(options?.pay),
    });

    return updated;
  });
}

/**
 * Membatalkan pesanan secara atomik, menandai soft-delete, dan melepas kunci sesi pelanggan jika relevan.
 */
export async function cancelOrder(
  id: string,
  reason?: string,
  actor?: string,
): Promise<Order> {
  return runInTransaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Pesanan dengan ID ${id} tidak ditemukan.`);
    }

    const updatedNotes = reason
      ? (existing.notes ? `${existing.notes} | ${reason}` : reason)
      : existing.notes;

    const updated = await tx.order.update({
      where: { id },
      data: {
        status: OrderStatus.CANCELLED,
        deleted_at: new Date(),
        notes: updatedNotes,
      },
    });

    await releaseCustomerSession(existing.customer_chat_id || existing.customer_contact, id);

    await recordEvent("INFO", "ORDER_SERVICE", "ORDER_MUTATED", {
      action: "CANCEL",
      order_id: id,
      actor: actor || "system",
      reason: reason || null,
    });

    return updated;
  });
}

/**
 * Menandai soft-delete pada pesanan tanpa menghapus baris secara fisik di basis data.
 */
export async function softDeleteOrder(id: string, actor?: string): Promise<Order> {
  return cancelOrder(id, undefined, actor);
}

/**
 * Mengubah status operasional pesanan dan menangani transisi penyelesaian / pembatalan.
 */
export async function setOrderStatus(
  id: string,
  status: OrderStatus,
  actor?: string,
): Promise<Order> {
  if (status === OrderStatus.COMPLETED) {
    return completeOrder(id, { actor });
  }
  if (status === OrderStatus.CANCELLED) {
    return cancelOrder(id, undefined, actor);
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status },
  });

  await recordEvent("INFO", "ORDER_SERVICE", "ORDER_MUTATED", {
    action: "STATUS_CHANGE",
    order_id: id,
    status,
    actor: actor || "system",
  });

  return updated;
}

/**
 * Memperbarui status pembayaran pesanan.
 */
export async function markPayment(
  id: string,
  paymentStatus: OrderPaymentStatus,
  actor?: string,
): Promise<Order> {
  const updated = await prisma.order.update({
    where: { id },
    data: { payment_status: paymentStatus },
  });

  await recordEvent("INFO", "ORDER_SERVICE", "ORDER_MUTATED", {
    action: "MARK_PAYMENT",
    order_id: id,
    payment_status: paymentStatus,
    actor: actor || "system",
  });

  return updated;
}

/**
 * Mengambil daftar seluruh pesanan aktif non-deleted.
 */
export async function listActiveOrders(): Promise<Order[]> {
  return prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS] },
      deleted_at: null,
    },
    orderBy: [
      { event_date: "asc" },
      { created_at: "desc" },
    ],
  });
}

/**
 * Mengambil dan memformat pesanan tersegmentasi (hari ini dan mendatang) untuk konsumsi tool dan antarmuka.
 */
export async function listOrdersSegmented(
  now: Date,
  tz: string,
): Promise<{
  today_orders: FormattedOrderSummary[];
  upcoming_orders: FormattedOrderSummary[];
  all_formatted: FormattedOrderSummary[];
  total_active: number;
}> {
  const { start: todayStart, end: todayEnd } = localDayUtcBounds(now, tz);
  const activeOpStatuses = [OrderStatus.PENDING, OrderStatus.IN_PROGRESS];

  const [ordersTodayRaw, upcomingOrdersRaw] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: { in: activeOpStatuses },
        deleted_at: null,
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
        deleted_at: null,
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

  const today_orders = ordersTodayRaw.map((o) => formatOrder(o, tz));
  const upcoming_orders = upcomingOrdersRaw.map((o) => formatOrder(o, tz));
  const all_formatted = [...today_orders, ...upcoming_orders];

  return {
    today_orders,
    upcoming_orders,
    all_formatted,
    total_active: all_formatted.length,
  };
}
