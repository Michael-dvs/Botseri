export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";

const blockSchema = z.object({
  phone_e164: z.string().trim().min(5).max(50),
  reason: z.string().trim().max(255).optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawJson = await request.json().catch(() => null);
  const parsed = blockSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Payload tidak valid", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { phone_e164, reason } = parsed.data;

  const updated = await prisma.customerSession.updateMany({
    where: { phone_e164 },
    data: {
      blocked_at: new Date(),
    },
  });

  await recordEvent("WARN", "customer_safety", "CUSTOMER_BLOCKED", {
    phone_e164,
    reason: reason || "Manual block by owner",
    actor: session.username || "admin",
  });

  return NextResponse.json({
    ok: true,
    message: `Nomor ${phone_e164} berhasil diblokir.`,
    count: updated.count,
  });
}
