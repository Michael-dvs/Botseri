export const dynamic = "force-dynamic";

import { setTimeout } from "node:timers/promises";
import { NextResponse } from "next/server";
import { getQrImage, restartSession } from "@/lib/waha/client";

export async function GET() {
  try {
    let upstream = await getQrImage();
    if (!upstream.ok) {
      // Jika QR expired / sesi FAILED (422), picu restart otomatis untuk membuat QR baru
      if (upstream.status === 422) {
        await restartSession();
        // Beri jeda singkat agar WAHA menginisiasi sesi dan QR baru
        await setTimeout(1500);
        upstream = await getQrImage();
      }
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: "QR tidak tersedia saat ini" },
        { status: upstream.status },
      );
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "WAHA tidak dapat dihubungi" },
      { status: 502 },
    );
  }
}
