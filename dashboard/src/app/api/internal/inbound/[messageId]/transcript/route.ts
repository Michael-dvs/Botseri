import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";

const schema = z.object({
  transcript: z.string().trim().min(1).max(20000),
});

export async function POST(
  request: Request,
  { params }: { params: { messageId: string } },
) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!z.string().uuid().safeParse(params.messageId).success) {
    return NextResponse.json({ error: "message_id tidak valid" }, { status: 400 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const updated = await prisma.messageLog.updateMany({
    where: { id: params.messageId, direction: "INBOUND" },
    data: { transcript: parsed.data.transcript, body: parsed.data.transcript },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Pesan tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
