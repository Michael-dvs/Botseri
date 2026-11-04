export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requestCode } from "@/lib/waha/client";

const schema = z.object({
  phone_number: z.string().trim().min(8).max(25),
});

const ResponseSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nomor telepon tidak valid" },
      { status: 400 },
    );
  }

  try {
    const upstream = await requestCode(parsed.data.phone_number);
    const raw = await upstream.json().catch(() => ({}));
    const validated = ResponseSchema.safeParse(raw);
    const body = validated.success ? validated.data : {};

    if (!upstream.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            body.message ??
            body.error ??
            "Gagal meminta kode pairing WhatsApp dari WAHA",
        },
        { status: upstream.status },
      );
    }

    if (!body.code) {
      return NextResponse.json(
        {
          ok: false,
          error: "WAHA tidak mengembalikan kode pairing",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, code: body.code });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Layanan WAHA tidak dapat dihubungi" },
      { status: 502 },
    );
  }
}
