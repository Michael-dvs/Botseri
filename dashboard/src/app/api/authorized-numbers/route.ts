export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const numbers = await prisma.authorizedNumber.findMany({
      orderBy: [{ is_primary: "desc" }, { created_at: "desc" }],
    });

    return NextResponse.json({
      ok: true,
      numbers,
    });
  } catch (error) {
    console.error("Gagal mengambil daftar nomor terotorisasi:", error);
    return NextResponse.json(
      { ok: false, error: "Gagal mengambil daftar nomor terotorisasi." },
      { status: 500 },
    );
  }
}
