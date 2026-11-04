export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generatePairingCode, pairingHash } from "@/lib/pairing";

const EXPIRY_MINUTES = 10;

export async function POST() {
  await prisma.pairingCode.deleteMany({
    where: { used_at: null, expires_at: { lt: new Date() } },
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generatePairingCode();
    try {
      await prisma.pairingCode.create({
        data: {
          code_hash: pairingHash(code),
          expires_at: new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000),
        },
      });
      return NextResponse.json({
        ok: true,
        code,
        expires_in_minutes: EXPIRY_MINUTES,
      });
    } catch (error) {
      // code_hash unik; tabrakan sangat jarang, ulangi dengan kode baru.
      const duplicate =
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002";
      if (!duplicate) throw error;
    }
  }

  return NextResponse.json(
    { ok: false, error: "Gagal membuat kode pairing, coba lagi" },
    { status: 500 },
  );
}
