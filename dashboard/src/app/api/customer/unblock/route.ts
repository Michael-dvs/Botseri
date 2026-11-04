export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";

const unblockSchema = z.object({
  phone_e164: z.string().trim().min(5).max(50),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawJson = await request.json().catch(() => null);
  const parsed = unblockSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Payload tidak valid", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { phone_e164 } = parsed.data;

  const updated = await prisma.customerSession.updateMany({
    where: { phone_e164 },
    data: {
      blocked_at: null,
    },
  });

  await recordEvent("INFO", "customer_safety", "CUSTOMER_UNBLOCKED", {
    phone_e164,
    actor: session.username || "admin",
  });

  return NextResponse.json({
    ok: true,
    message: `Blokir untuk nomor ${phone_e164} berhasil dibuka.`,
    count: updated.count,
  });
}
