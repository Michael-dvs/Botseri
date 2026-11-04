export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { downloadMediaBuffer } from "@/lib/waha/client";

const schema = z.object({
  message_id: z.string().uuid(),
  media_url: z.string().url(),
});

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { message_id, media_url } = parsed.data;

  const message = await prisma.messageLog.findUnique({
    where: { id: message_id },
  });
  if (!message) {
    return NextResponse.json(
      { ok: false, error: "message_id tidak ditemukan" },
      { status: 404 },
    );
  }

  let audioBuffer: Buffer;
  try {
    audioBuffer = await downloadMediaBuffer(media_url);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Gagal mengunduh audio dari WAHA",
      },
      { status: 502 },
    );
  }

  // Kirim ke endpoint STT internal gateway
  const internalToken = process.env.INTERNAL_API_TOKEN ?? "";
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: message.media_type || "audio/ogg" }),
    "voice_note.ogg",
  );
  formData.append("model", "botseri-default");

  const sttRes = await fetch(
    "http://127.0.0.1:3000/api/internal/llm/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${internalToken}`,
      },
      body: formData,
    },
  );

  const sttBody = (await sttRes.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!sttRes.ok || !sttBody.text) {
    return NextResponse.json(
      {
        ok: false,
        error: sttBody.error ?? "Gagal melakukan transkripsi audio",
      },
      { status: sttRes.status },
    );
  }

  const transcript = sttBody.text.trim();

  // Simpan hasil transkripsi ke message_log
  await prisma.messageLog.update({
    where: { id: message_id },
    data: { transcript },
  });

  return NextResponse.json({ ok: true, text: transcript });
}
