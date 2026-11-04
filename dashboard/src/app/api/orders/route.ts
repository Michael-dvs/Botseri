export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";

const createSchema = z.object({
  customer_name: z.string().trim().min(1).max(150),
  customer_contact: z.string().trim().max(50).nullable().optional(),
  description: z.string().trim().min(1).max(4000),
  event_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_address: z.string().trim().max(2000).nullable().optional(),
  total_amount: z.number().nonnegative().nullable().optional(),
  dp_amount: z.number().nonnegative().nullable().optional(),
  payment_status: z.enum(["UNPAID", "DP_PAID", "PAID"]).default("UNPAID"),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("PENDING"),
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

export async function GET() {
  const orders = await prisma.order.findMany({
    orderBy: { delivery_date: { sort: "asc", nulls: "last" } },
    take: 200,
  });
  return NextResponse.json({ ok: true, orders: orders.map(toResponse) });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  try {
    const order = await prisma.order.create({
      data: {
        customer_name: input.customer_name,
        customer_contact: input.customer_contact ?? null,
        description: input.description,
        event_date: input.event_date ? new Date(input.event_date) : null,
        delivery_date: input.delivery_date
          ? new Date(input.delivery_date)
          : null,
        delivery_address: input.delivery_address ?? null,
        total_amount: input.total_amount ?? null,
        dp_amount: input.dp_amount ?? null,
        payment_status: input.payment_status,
        status: input.status,
        notes: input.notes ?? null,
      },
    });
    return NextResponse.json({ ok: true, order: toResponse(order) });
  } catch (error) {
    log("ERROR", "api.orders", "create failed", undefined, error);
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan pesanan" },
      { status: 500 },
    );
  }
}
