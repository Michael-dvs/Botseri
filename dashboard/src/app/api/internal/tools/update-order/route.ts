export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderPaymentStatus, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";

const UpdateOrderSchema = z.object({
  order_id: z.string().trim().min(1),
  action: z.enum([
    "MARK_COMPLETED",
    "COMPLETE", // Backward-compatible alias for MARK_COMPLETED
    "MARK_IN_PROGRESS",
    "MARK_PAID",
    "MARK_DP",
    "COMPLETE_AND_PAY",
    "CANCEL",
    "DELETE",
  ]),
  notes: z.string().optional(),
});

function formatPaymentStatusText(status: OrderPaymentStatus): string {
  if (status === OrderPaymentStatus.PAID) return "Lunas";
  if (status === OrderPaymentStatus.DP_PAID) return "Sudah DP";
  return "Belum dibayar";
}

function formatOperationalStatusText(status: OrderStatus): string {
  if (status === OrderStatus.COMPLETED) return "SELESAI dikerjakan/dikirim";
  if (status === OrderStatus.IN_PROGRESS) return "SEDANG DIKERJAKAN";
  if (status === OrderStatus.CANCELLED) return "DIBATALKAN";
  return "MENUNGGU pengerjaan/pengiriman";
}

async function unmuteCustomerSession(customerContact: string | null) {
  if (!customerContact) return;
  const rawContact = customerContact.trim();
  const contactDigits = rawContact.replace(/\D/g, "");
  await prisma.customerSession.updateMany({
    where: {
      OR: [
        { phone_e164: rawContact },
        { phone_e164: `+${contactDigits}` },
        { phone_e164: contactDigits },
      ],
    },
    data: {
      state: "ACTIVE",
      paused_at: null,
    },
  });
}

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawJson = await request.json().catch(() => null);
  const parsed = UpdateOrderSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Payload tidak valid", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { order_id, action, notes } = parsed.data;

  // Support Bulk Action (ALL / SEMUA)
  const isBulk =
    order_id.trim().toUpperCase() === "ALL" ||
    order_id.trim().toUpperCase() === "SEMUA";

  if (isBulk) {
    const activeOrders = await prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS] },
      },
      select: { id: true, customer_contact: true },
    });

    if (activeOrders.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Semua pesanan memang sudah berstatus selesai sebelumnya.",
      });
    }

    const orderIds = activeOrders.map((o) => o.id);
    const updateData: {
      status: OrderStatus;
      completed_at: Date;
      notes?: string;
      payment_status?: OrderPaymentStatus;
    } = {
      status: OrderStatus.COMPLETED,
      completed_at: new Date(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    if (action === "COMPLETE_AND_PAY" || action === "MARK_PAID") {
      updateData.payment_status = OrderPaymentStatus.PAID;
    }

    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: updateData,
    });

    const contacts = activeOrders
      .map((o) => o.customer_contact)
      .filter((c): c is string => Boolean(c));

    for (const contact of contacts) {
      await unmuteCustomerSession(contact);
    }

    return NextResponse.json({
      ok: true,
      action,
      message: `Sebanyak ${activeOrders.length} pesanan aktif berhasil ditandai selesai.`,
      updated_count: activeOrders.length,
    });
  }

  const cleanId = order_id.replace(/^#?ORD-/i, "").trim().toLowerCase();
  // 1. Try exact UUID match if valid UUID format
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cleanId
    );

  let order = isUuid
    ? await prisma.order.findUnique({ where: { id: cleanId } })
    : null;

  // 2. If not found by direct UUID, search by ID prefix or customer name
  if (!order) {
    const prefix = `${cleanId}%`;
    const searchPattern = `%${cleanId}%`;

    const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "orders"
      WHERE "id"::text ILIKE ${prefix}
         OR "customer_name" ILIKE ${searchPattern}
      ORDER BY "created_at" DESC
      LIMIT 1
    `;

    if (candidates.length > 0) {
      order = await prisma.order.findUnique({
        where: { id: candidates[0].id },
      });
    }
  }

  if (!order) {
    return NextResponse.json(
      {
        ok: false,
        error: `Pesanan dengan ID atau nama '${order_id}' tidak ditemukan.`,
      },
      { status: 404 }
    );
  }

  const shortId = `#ORD-${order.id.slice(0, 8).toUpperCase()}`;

  // Action: DELETE
  if (action === "DELETE") {
    await prisma.order.delete({
      where: { id: order.id },
    });
    await unmuteCustomerSession(order.customer_contact);

    return NextResponse.json({
      ok: true,
      action: "DELETE",
      message: `Pesanan ${shortId} (${order.customer_name}) berhasil dihapus dari sistem.`,
    });
  }

  // Action: CANCEL
  if (action === "CANCEL") {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
      },
    });
    await unmuteCustomerSession(order.customer_contact);

    return NextResponse.json({
      ok: true,
      action: "CANCEL",
      message: `Pesanan ${shortId} (${order.customer_name}) telah DIBATALKAN.`,
    });
  }

  // Action: MARK_COMPLETED / COMPLETE
  if (action === "MARK_COMPLETED" || action === "COMPLETE") {
    const extraNotes = notes ? ` (${notes})` : "";
    const updatedNotes =
      (order.notes ? `${order.notes} | ` : "") + `[STATUS: SELESAI]${extraNotes}`;

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.COMPLETED,
        completed_at: new Date(),
        notes: updatedNotes,
      },
    });
    await unmuteCustomerSession(order.customer_contact);

    const paymentText = formatPaymentStatusText(updated.payment_status);
    return NextResponse.json({
      ok: true,
      action: "MARK_COMPLETED",
      message: `Pesanan ${shortId} (${order.customer_name}) telah ditandai SELESAI dikerjakan/dikirim. Status pembayaran: ${paymentText}. Bot di-unmute untuk nomor pelanggan ini.`,
    });
  }

  // Action: MARK_PAID
  if (action === "MARK_PAID") {
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        payment_status: OrderPaymentStatus.PAID,
      },
    });

    const opText = formatOperationalStatusText(updated.status);
    return NextResponse.json({
      ok: true,
      action: "MARK_PAID",
      message: `Pembayaran pesanan ${shortId} (${order.customer_name}) telah ditandai LUNAS. Status pengerjaan: ${opText}.`,
    });
  }

  // Action: MARK_DP
  if (action === "MARK_DP") {
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        payment_status: OrderPaymentStatus.DP_PAID,
      },
    });

    const opText = formatOperationalStatusText(updated.status);
    return NextResponse.json({
      ok: true,
      action: "MARK_DP",
      message: `Pembayaran pesanan ${shortId} (${order.customer_name}) telah ditandai SUDAH DP. Status pengerjaan: ${opText}.`,
    });
  }

  // Action: MARK_IN_PROGRESS
  if (action === "MARK_IN_PROGRESS") {
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.IN_PROGRESS,
      },
    });

    const paymentText = formatPaymentStatusText(updated.payment_status);
    return NextResponse.json({
      ok: true,
      action: "MARK_IN_PROGRESS",
      message: `Pesanan ${shortId} (${order.customer_name}) telah ditandai SEDANG DIKERJAKAN. Status pembayaran: ${paymentText}.`,
    });
  }

  // Action: COMPLETE_AND_PAY
  if (action === "COMPLETE_AND_PAY") {
    const extraNotes = notes ? ` (${notes})` : "";
    const updatedNotes =
      (order.notes ? `${order.notes} | ` : "") + `[STATUS: SELESAI]${extraNotes}`;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.COMPLETED,
        completed_at: new Date(),
        payment_status: OrderPaymentStatus.PAID,
        notes: updatedNotes,
      },
    });
    await unmuteCustomerSession(order.customer_contact);

    return NextResponse.json({
      ok: true,
      action: "COMPLETE_AND_PAY",
      message: `Pesanan ${shortId} (${order.customer_name}) telah ditandai SELESAI dan LUNAS. Bot di-unmute untuk nomor pelanggan ini.`,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
