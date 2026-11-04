export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { recordEvent } from "@/lib/events";
import { resetWahaCircuitBreaker } from "@/lib/waha/humanizer";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Verifikasi Origin CSRF jika header Origin ada
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { ok: false, error: "Origin CSRF tidak valid" },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { ok: false, error: "Header origin tidak valid" },
        { status: 400 }
      );
    }
  }

  await resetWahaCircuitBreaker();

  await recordEvent("INFO", "waha.guard", "WAHA_GUARD_RESET", {
    actor: session.username || "admin",
    reset_at: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    status: "NORMAL",
    message: "Circuit Breaker WAHA berhasil diatur ulang menjadi NORMAL.",
  });
}
