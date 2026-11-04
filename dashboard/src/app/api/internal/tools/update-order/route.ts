export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { OrderPaymentStatus, OrderStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { completeOrder, markPayment, setOrderStatus, formatOperationalStatusText, formatPaymentStatusText } from "@/lib/orders/service";
import { getPrimaryOwner } from "@/lib/owner/primary";
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
  owner_chat_id: z.string().optional(),
  message_id: z.string().optional(),
});

async function resolveOwnerChatId(reqOwnerChatId?: string | null): Promise<string> {
  if (reqOwnerChatId && reqOwnerChatId.trim()) return reqOwnerChatId.trim();
  const primary = await getPrimaryOwner();
  return primary?.chat_id || "6281234567890@c.us";
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
        deleted_at: null,
      },
      select: { id: true, customer_chat_id: true, customer_contact: true },
    });

    if (activeOrders.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Semua pesanan memang sudah berstatus selesai sebelumnya.",
      });
    }

    // Batas Massal: Maksimum 50 pesanan per eksekusi ALL/SEMUA
    if (activeOrders.length > 50) {
      return NextResponse.json(
        {
          ok: false,
          error: "Jumlah pesanan aktif melebihi batas maksimal eksekusi massal (maksimal 50 pesanan). Silakan proses pesanan satu per satu.",
        },
        { status: 400 }
      );
    }

    // Invariant INV-15: Konfirmasi Dua Langkah Deterministik di Sisi Server
    const ownerChatId = await resolveOwnerChatId(parsed.data.owner_chat_id);
    const previewText = `Konfirmasi eksekusi massal untuk ${activeOrders.length} pesanan aktif.`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.pendingConfirmation.create({
      data: {
        owner_chat_id: ownerChatId,
        action: "BULK_COMPLETE",
        payload_json: {
          action,
          order_ids: activeOrders.map((o) => o.id),
          notes: notes || null,
        },
        preview_text: previewText,
        created_message_id: parsed.data.message_id || null,
        expires_at: expiresAt,
      },
    });

    return NextResponse.json({
      ok: true,
      requires_confirmation: true,
      action: "BULK_COMPLETE",
      preview: previewText,
      instruksi_untuk_owner: "Balas YA untuk melanjutkan, atau abaikan untuk membatalkan.",
    });
  }

  const cleanId = order_id.replace(/^#?ORD-/i, "").trim().toLowerCase();
  // 1. Try exact UUID match if valid UUID format
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cleanId
    );

  let order = isUuid
    ? await prisma.order.findFirst({ where: { id: cleanId, deleted_at: null } })
    : null;

  // 2. If not found by direct UUID, search by ID prefix or customer name with ambiguity check
  if (!order) {
    const prefix = `${cleanId}%`;
    const searchPattern = `%${cleanId}%`;

    const candidates = await prisma.$queryRaw<Array<{ id: string; customer_name: string; description: string }>>`
      SELECT id, customer_name, description FROM "orders"
      WHERE ("id"::text ILIKE ${prefix} OR "customer_name" ILIKE ${searchPattern})
        AND "deleted_at" IS NULL
      ORDER BY "created_at" DESC
      LIMIT 5
    `;

    if (candidates.length > 1) {
      return NextResponse.json({
        ok: false,
        ambiguous: true,
        candidates: candidates.map((c) => ({
          order_id: `#ORD-${c.id.slice(0, 8).toUpperCase()}`,
          customer_name: c.customer_name,
          service_type: c.description,
        })),
        message: "Ditemukan lebih dari 1 pesanan yang cocok dengan kueri tersebut. Mohon sebutkan ID pesanan yang lebih spesifik.",
      });
    }

    if (candidates.length === 1) {
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

  // Invariant INV-15: Aksi Destruktif (DELETE / CANCEL) Wajib Konfirmasi Dua Langkah
  if (action === "DELETE" || action === "CANCEL") {
    const ownerChatId = await resolveOwnerChatId(parsed.data.owner_chat_id);
    const actionLabel = action === "DELETE" ? "HAPUS" : "BATALKAN";
    const previewText = `Konfirmasi ${actionLabel} pesanan ${shortId} (${order.customer_name} - ${order.description}).`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.pendingConfirmation.create({
      data: {
        owner_chat_id: ownerChatId,
        action,
        payload_json: {
          order_id: order.id,
          action,
          notes: notes || null,
        },
        preview_text: previewText,
        created_message_id: parsed.data.message_id || null,
        expires_at: expiresAt,
      },
    });

    return NextResponse.json({
      ok: true,
      requires_confirmation: true,
      action,
      preview: previewText,
      instruksi_untuk_owner: "Balas YA untuk melanjutkan, atau abaikan untuk membatalkan.",
    });
  }

  // Action: MARK_COMPLETED / COMPLETE
  if (action === "MARK_COMPLETED" || action === "COMPLETE") {
    const updatedNotes = notes ? (order.notes ? `${order.notes} | ${notes}` : notes) : order.notes;
    const updated = await completeOrder(order.id, { notes: updatedNotes, actor: "OWNER_TOOL" });
    const paymentText = formatPaymentStatusText(updated.payment_status);
    return NextResponse.json({
      ok: true,
      action: "MARK_COMPLETED",
      message: `Pesanan ${shortId} (${order.customer_name}) telah ditandai SELESAI dikerjakan/dikirim. Status pembayaran: ${paymentText}. Bot di-unmute untuk nomor pelanggan ini.`,
    });
  }

  // Action: MARK_PAID
  if (action === "MARK_PAID") {
    const updated = await markPayment(order.id, OrderPaymentStatus.PAID, "OWNER_TOOL");
    const opText = formatOperationalStatusText(updated.status);
    return NextResponse.json({
      ok: true,
      action: "MARK_PAID",
      message: `Pembayaran pesanan ${shortId} (${order.customer_name}) telah ditandai LUNAS. Status pengerjaan: ${opText}.`,
    });
  }

  // Action: MARK_DP
  if (action === "MARK_DP") {
    const updated = await markPayment(order.id, OrderPaymentStatus.DP_PAID, "OWNER_TOOL");
    const opText = formatOperationalStatusText(updated.status);
    return NextResponse.json({
      ok: true,
      action: "MARK_DP",
      message: `Pembayaran pesanan ${shortId} (${order.customer_name}) telah ditandai SUDAH DP. Status pengerjaan: ${opText}.`,
    });
  }

  // Action: MARK_IN_PROGRESS
  if (action === "MARK_IN_PROGRESS") {
    const updated = await setOrderStatus(order.id, OrderStatus.IN_PROGRESS, "OWNER_TOOL");
    const paymentText = formatPaymentStatusText(updated.payment_status);
    return NextResponse.json({
      ok: true,
      action: "MARK_IN_PROGRESS",
      message: `Pesanan ${shortId} (${order.customer_name}) telah ditandai SEDANG DIKERJAKAN. Status pembayaran: ${paymentText}.`,
    });
  }

  // Action: COMPLETE_AND_PAY
  if (action === "COMPLETE_AND_PAY") {
    const updatedNotes = notes ? (order.notes ? `${order.notes} | ${notes}` : notes) : order.notes;
    await completeOrder(order.id, { pay: true, notes: updatedNotes, actor: "OWNER_TOOL" });
    return NextResponse.json({
      ok: true,
      action: "COMPLETE_AND_PAY",
      message: `Pesanan ${shortId} (${order.customer_name}) telah ditandai SELESAI dan LUNAS. Bot di-unmute untuk nomor pelanggan ini.`,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
