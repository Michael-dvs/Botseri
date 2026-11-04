export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  const row = await prisma.oAuthToken.findFirst({
    where: { provider: "google" },
  });
  if (row) {
    await prisma.oAuthToken.update({
      where: { id: row.id },
      data: {
        status: "DISCONNECTED",
        access_token_enc: null,
        refresh_token_enc: null,
        expires_at: null,
        account_email: null,
      },
    });
  }
  return NextResponse.json({ ok: true });
}
