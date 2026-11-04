import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";

const schema = z.object({
  chat_id: z.string().min(1).max(100),
  body: z.string().min(1).max(20000),
  in_reply_to: z.string().max(255).nullable().optional(),
});

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  await prisma.messageLog.create({
    data: {
      direction: "OUTBOUND",
      chat_id: parsed.data.chat_id,
      body: parsed.data.body,
      in_reply_to: parsed.data.in_reply_to ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}
