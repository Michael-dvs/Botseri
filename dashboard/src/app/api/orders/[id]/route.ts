export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";

const uuidSchema = z.string().uuid();

const updateSchema = z.object({
  customer_name: z.string().trim().min(1).max(150).optional(),
  customer_contact: z.string().trim().max(50).nullable().optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  event_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_address: z.string().trim().max(2000).nullable().optional(),
  total_amount: z.number().nonnegative().nullable().optional(),
  dp_amount: z.number().nonnegative().nullable().optional(),
  payment_status: z.enum(["UNPAID", "DP_PAID", "PAID"]).optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

function toResponse<
  T extends { total_amount: unknown; dp_amount: unknown },
>(order: T) {
  return {
    ...order,
    total_amount: order.total_amount ? Number(order.total_amount) : null,
    dp_amount: order.dp_amount ? Number(order.dp_amount) : null,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }

  const parsed = updateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const existing = await prisma.order.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }

  try {
    const order = await prisma.order.update({
      where: { id: params.id },
      data: {
        customer_name: input.customer_name ?? existing.customer_name,
        customer_contact:
          input.customer_contact === undefined
            ? existing.customer_contact
            : input.customer_contact,
        description: input.description ?? existing.description,
        event_date:
          input.event_date === undefined
            ? existing.event_date
            : input.event_date
              ? new Date(input.event_date)
              : null,
        delivery_date:
          input.delivery_date === undefined
            ? existing.delivery_date
            : input.delivery_date
              ? new Date(input.delivery_date)
              : null,
        delivery_address:
          input.delivery_address === undefined
            ? existing.delivery_address
            : input.delivery_address,
        total_amount:
          input.total_amount === undefined
            ? existing.total_amount
            : input.total_amount,
        dp_amount:
          input.dp_amount === undefined ? existing.dp_amount : input.dp_amount,
        payment_status: input.payment_status ?? existing.payment_status,
        status: input.status ?? existing.status,
        completed_at:
          input.status === "COMPLETED"
            ? existing.completed_at || new Date()
            : input.status !== undefined
              ? null
              : existing.completed_at,
        notes: input.notes === undefined ? existing.notes : input.notes,
      },
    });

    // AUTO-UNMUTE: Buka kunci sesi pelanggan terkait di customer_sessions
    if (order.status === "COMPLETED" && order.customer_contact) {
      const cleanPhone = order.customer_contact.trim();
      const withPlus = cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`;
      const withoutPlus = cleanPhone.replace(/^\+/, "");

      await prisma.customerSession.updateMany({
        where: {
          phone_e164: { in: [cleanPhone, withPlus, withoutPlus] },
        },
        data: {
          state: "ACTIVE",
          paused_at: null,
          metadata: {
            draft: null,
            retry_count: 0,
          },
        },
      });
    }

    return NextResponse.json({ ok: true, order: toResponse(order) });
  } catch (error) {
    log("ERROR", "api.orders", "update failed", { id: params.id }, error);
    return NextResponse.json(
      { ok: false, error: "Gagal memperbarui pesanan" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }

  const deleted = await prisma.order.deleteMany({ where: { id: params.id } });
  if (deleted.count === 0) {
    return NextResponse.json(
      { ok: false, error: "tidak ditemukan" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
