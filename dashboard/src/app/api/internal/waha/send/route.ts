export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { log } from "@/lib/logger";
import { HumanizerError, sendHumanizedMessage } from "@/lib/waha/humanizer";
import { validateAgentOutput, FALLBACK_INVALID_REPLY } from "@/lib/waha/guard";
import { OUTBOUND_TRIGGERS, type Trigger } from "@/lib/waha/triggers";
const schema = z
  .object({
    phone_e164: z.string().trim().nullable().optional(),
    chat_id: z.string().trim().nullable().optional(),
    body: z.string().min(1).max(4096),
    trigger_type: z.enum(OUTBOUND_TRIGGERS),
    reply_to_message_id: z.string().uuid().optional(),
    reply_to_wa_message_id: z.string().trim().max(255).optional(),
    idempotency_key: z.string().trim().min(1).max(255).optional(),
  })
  .refine((data) => Boolean(data.phone_e164 || data.chat_id), {
    message: "Salah satu dari phone_e164 atau chat_id wajib diisi",
  });

function normalizeChatId(phone?: string | null, chatId?: string | null): string {
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits) return `${digits}@c.us`;
  }
  if (chatId) {
    const trimmed = chatId.trim();
    if (trimmed.endsWith("@c.us") || trimmed.endsWith("@s.whatsapp.net")) {
      const digits = trimmed.split("@")[0].replace(/\D/g, "");
      return `${digits}@c.us`;
    }
    if (trimmed.endsWith("@lid")) {
      return trimmed;
    }
    const digits = trimmed.replace(/\D/g, "");
    return digits ? `${digits}@c.us` : trimmed;
  }
  return "";
}

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

  const input = parsed.data;
  let targetChatId = normalizeChatId(input.phone_e164, input.chat_id);
  if (targetChatId.endsWith("@lid")) {
    const auth = await prisma.authorizedNumber.findFirst({
      where: { chat_id: targetChatId },
      select: { phone_e164: true },
    });
    if (auth?.phone_e164) {
      targetChatId = `${auth.phone_e164.replace(/\D/g, "")}@c.us`;
    }
  }
  const normalizedPhone =
    input.phone_e164 ||
    (targetChatId.endsWith("@c.us")
      ? `+${targetChatId.replace(/@c\.us$/, "")}`
      : `+${targetChatId.replace(/\D/g, "")}`);

  if (input.trigger_type !== "PAIRING" && input.trigger_type !== "NEW_ORDER_ALERT") {
    const isAuthorized =
      (await prisma.authorizedNumber.findUnique({
        where: { phone_e164: normalizedPhone },
      })) ??
      (typeof prisma.authorizedNumber.findFirst === "function"
        ? await prisma.authorizedNumber.findFirst({
            where: {
              OR: [
                { phone_e164: normalizedPhone },
                { chat_id: targetChatId },
              ],
            },
          })
        : null);

    let isCustomer = null;
    if (!isAuthorized) {
      isCustomer =
        (await prisma.customerSession.findUnique({
          where: { phone_e164: normalizedPhone },
        })) ??
        (typeof prisma.customerSession.findFirst === "function"
          ? await prisma.customerSession.findFirst({
              where: {
                OR: [
                  { phone_e164: normalizedPhone },
                  { phone_e164: normalizedPhone.replace(/^\+/, "") },
                ],
              },
            })
          : null);
    }

    if (!isAuthorized && !isCustomer) {
      return NextResponse.json(
        {
          ok: false,
          error: "Nomor tujuan tidak terdaftar di authorized_numbers maupun customer_sessions",
          code: "UNAUTHORIZED_RECIPIENT",
        },
        { status: 403 },
      );
    }
  }

  const idempotencyTag = input.idempotency_key
    ? `scheduler:${input.idempotency_key}`
    : null;
  if (idempotencyTag) {
    const existing = await prisma.messageLog.findFirst({
      where: { direction: "OUTBOUND", in_reply_to: idempotencyTag },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "IDEMPOTENT_OUTBOUND_SUPPRESSED",
        message_id: existing.id,
      });
    }
  }

  // Output Guard: Validasi teks sebelum dikirim (hanya untuk CHAT_MASUK agar brief/eval tidak terpotong)
  let textToSend = input.body;
  if (input.trigger_type === "CHAT_MASUK") {
    const guard = validateAgentOutput(input.body, input.trigger_type);
    if (!guard.valid) {
      log("WARN", "waha.send", `output guard triggered: ${guard.reason}`);
      textToSend = guard.fallbackText ?? FALLBACK_INVALID_REPLY;
    }
  }
  // 1. Deduplikasi Outbound: cek pesan identik ke nomor yang sama dalam 45 detik terakhir
  const fortyFiveSecondsAgo = new Date(Date.now() - 45_000);
  const recentDuplicate = await prisma.messageLog.findFirst({
    where: {
      direction: "OUTBOUND",
      chat_id: targetChatId,
      body: textToSend,
      created_at: { gte: fortyFiveSecondsAgo },
    },
    orderBy: { created_at: "desc" },
  });

  if (recentDuplicate) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "DUPLICATE_OUTBOUND_SUPPRESSED",
      message_id: recentDuplicate.id,
    });
  }

  // 2. Kirim pesan melalui humanizer queue & rate-limiter
  let sendResult: { ok: boolean; response: unknown };
  const skipDelay = request.headers.get("x-botseri-fast-test") === "1";
  try {
    sendResult = await sendHumanizedMessage({
      chatId: targetChatId,
      text: textToSend,
      replyToWaMessageId: input.reply_to_wa_message_id,
      isPairing: input.trigger_type === "PAIRING" || input.trigger_type === "NEW_ORDER_ALERT",
      trigger: input.trigger_type as Trigger,
      skipDelay,
    });
  } catch (error) {
    if (error instanceof HumanizerError) {
      if (
        error.status === 429 &&
        (input.trigger_type === "CUSTOMER_REPLY" ||
          input.trigger_type === "CUSTOM_REPLY" ||
          input.trigger_type === "OWNER_DIGEST" ||
          input.trigger_type === "TASK_ALARM" ||
          input.trigger_type === "NEW_ORDER_ALERT")
      ) {
        log("WARN", "waha.send", "rate limit reached for bot reply, queueing in background with 202 Accepted", {
          targetChatId,
          trigger_type: input.trigger_type,
        });

        void (async () => {
          try {
            await new Promise((resolve) => setTimeout(resolve, 4000));
            await sendHumanizedMessage({
              chatId: targetChatId,
              text: textToSend,
              replyToWaMessageId: input.reply_to_wa_message_id,
              trigger: input.trigger_type as Trigger,
            });
          } catch (bgErr) {
            log("ERROR", "waha.send", "background delayed send failed", { targetChatId }, bgErr);
          }
        })();

        return NextResponse.json(
          {
            ok: true,
            queued: true,
            warning: "OUTBOUND_RATE_LIMIT_DELAYED",
            message: "Pesan balasan bot dialihkan ke antrean tunda latar belakang.",
          },
          { status: 202 },
        );
      }

      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    const errMsg = error instanceof Error ? error.message : "Internal error";
    log("ERROR", "waha.send", "failed to send outbound message", { targetChatId }, error);
    return NextResponse.json(
      { ok: false, error: `Gagal mengirim pesan: ${errMsg}` },
      { status: 500 },
    );
  }

  // 3. Catat ke tabel message_log
  const inReplyTo = idempotencyTag
    ?? input.reply_to_wa_message_id
    ?? input.reply_to_message_id
    ?? null;
  const createdLog = await prisma.messageLog.create({
    data: {
      direction: "OUTBOUND",
      chat_id: targetChatId,
      body: textToSend,
      in_reply_to: inReplyTo,
    },
  });

  return NextResponse.json({
    ok: true,
    message_id: createdLog.id,
    wa_response: sendResult.response,
  });
}
