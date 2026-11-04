import { NextResponse } from "next/server";
import { OrderStatus, Prisma, type MessageLog } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { recordEvent } from "@/lib/events";
import { PAIRING_PATTERN, pairingHash } from "@/lib/pairing";
import { resolveSenderE164, isLidSender, getLidIdentifier } from "@/lib/phone";
import { lookupLidContact } from "@/lib/waha/client";
import { normalizePhoneE164 } from "@/lib/customer/phone";
import { looksLikeOrderForm } from "@/lib/customer/orderFormat";
import { getActivePipelineConfig } from "@/lib/pipeline/manager";

const customerRateLimitMap = new Map<string, number[]>();


const schema = z.object({
  wa_message_id: z.string().min(1).max(255),
  chat_id: z.string().max(100).nullable().optional(),
  from: z.string().max(100).nullable().optional(),
  sender: z.string().max(100).nullable().optional(),
  participant: z.string().max(100).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
  phone_e164: z.string().max(100).nullable().optional(),
  remote_jid_alt: z.string().max(100).nullable().optional(),
  remoteJidAlt: z.string().max(100).nullable().optional(),
  sender_pn: z.string().max(100).nullable().optional(),
  senderPn: z.string().max(100).nullable().optional(),
  author: z.string().max(100).nullable().optional(),
  _data: z.record(z.string(), z.unknown()).nullable().optional(),
  body: z.string().max(20000).nullable().optional().default(""),
  has_media: z.boolean().optional().default(false),
  media_type: z.string().max(50).nullable().optional(),
  received_at: z.string().datetime({ offset: true }),
  from_me: z.boolean().optional().default(false),
  fromMe: z.boolean().optional(),
});

function response(
  accept: boolean,
  reason: string,
  messageId: string | null,
  chatId: string,
  replyText: string | null = null,
  paired: boolean = false,
  phoneE164: string | null = null,
  role?: "OWNER" | "CUSTOMER",
  intent: "SUBMIT_ORDER" | null = null,
  customerPhone: string | null = null,
) {
  return NextResponse.json({
    accept,
    paired,
    reason,
    message_id: messageId,
    chat_id: chatId,
    reply_to_chat_id: chatId,
    reply_text: replyText,
    ...(role ? { role } : {}),
    ...(customerPhone ? { customer_phone: customerPhone } : {}),
    ...(role === "CUSTOMER" ? { intent } : {}),
    ...(phoneE164 ? { phone_e164: phoneE164 } : {}),
  });
}

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const input = parsed.data;

  // 1. Sender extraction & hard guard
  // Priority order: participant -> remote_jid_alt -> sender_pn -> phone_e164 -> phone -> author -> sender -> from -> chat_id.
  let normalizedPhone = resolveSenderE164(input);
  if (!normalizedPhone && isLidSender(input)) {
    const lid = getLidIdentifier(input);
    if (lid) {
      normalizedPhone = await lookupLidContact(lid);
    }
  }

  if (!normalizedPhone) {
    const isLid = isLidSender(input);
    return NextResponse.json(
      { accept: false, error: isLid ? "unresolvable_lid" : "invalid_sender" },
      { status: 400 },
    );
  }

  const targetChatId = input.chat_id || `${normalizedPhone.slice(1)}@c.us`;

  const pipeline = await getActivePipelineConfig();
  const gate = pipeline.config.inbound_gate;

  const isNonPersonal =
    targetChatId.endsWith("@g.us") ||
    targetChatId.includes("@newsletter") ||
    targetChatId === "status@broadcast" ||
    targetChatId.includes("@broadcast");
  if (isNonPersonal) {
    const isGroup = targetChatId.endsWith("@g.us");
    if (isGroup && gate.enabled && !gate.ignore_groups) {
      // If ignore_groups is explicitly disabled, allow processing
    } else {
      const reason = isGroup ? "GROUP_IGNORED" : "NON_PERSONAL_CHAT_IGNORED";
      return response(false, reason, null, targetChatId);
    }
  }
  const duplicate = await prisma.messageLog.findUnique({
    where: { wa_message_id: input.wa_message_id },
  });
  if (duplicate) {
    return response(false, "DUPLICATE", duplicate.id, targetChatId);
  }

  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  if (!settings?.setup_completed) {
    return response(false, "SETUP_INCOMPLETE", null, targetChatId);
  }
  if (!settings.bot_enabled) {
    return response(false, "BOT_DISABLED", null, targetChatId);
  }

  // 2. Pairing flow
  const code = (input.body ?? "").trim().toUpperCase();
  if (PAIRING_PATTERN.test(code)) {
    const hash = pairingHash(code);
    const pairResult = await prisma.$transaction(async (tx) => {
      // Find valid, unused, unexpired code inside the transaction
      const pairing = await tx.pairingCode.findFirst({
        where: {
          code_hash: hash,
          used_at: null,
          expires_at: { gt: new Date() },
        },
      });

      if (!pairing) {
        // Check if sender is already an authorized owner
        const existingOwner = await tx.authorizedNumber.findFirst({
          where: {
            OR: [
              { phone_e164: normalizedPhone },
              { chat_id: targetChatId },
            ],
            is_owner: true,
          },
        });
        if (existingOwner) {
          return { status: "ALREADY_PAIRED" as const };
        }
        return { status: "INVALID_CODE" as const };
      }

      // Mark pairing code as used
      const updated = await tx.pairingCode.updateMany({
        where: { id: pairing.id, used_at: null },
        data: { used_at: new Date() },
      });
      if (updated.count === 0) {
        return { status: "CONCURRENTLY_USED" as const };
      }

      // Cek apakah sudah ada nomor owner yang berstatus primary
      const existingPrimary = await tx.authorizedNumber.findFirst({
        where: { is_owner: true, is_primary: true },
      });
      const shouldBePrimary = !existingPrimary;

      // Upsert authorized number keyed on phone_e164
      await tx.authorizedNumber.upsert({
        where: { phone_e164: normalizedPhone },
        create: {
          phone_e164: normalizedPhone,
          chat_id: targetChatId,
          is_owner: true,
          is_primary: shouldBePrimary,
          label: "Owner (paired)",
        },
        update: {
          chat_id: targetChatId,
          is_owner: true,
          ...(shouldBePrimary ? { is_primary: true } : {}),
          label: "Owner (paired)",
        },
      });

      return { status: "SUCCESS" as const };
    });

    if (pairResult.status === "SUCCESS") {
      return NextResponse.json({
        accept: true,
        role: "OWNER",
        paired: true,
        phone_e164: normalizedPhone,
        chat_id: targetChatId,
        reply_to_chat_id: targetChatId,
        reply_text: "Nomor Anda berhasil diotorisasi sebagai Owner Botseri!",
      });
    }

    if (pairResult.status === "ALREADY_PAIRED") {
      return NextResponse.json({
        accept: true,
        role: "OWNER",
        paired: true,
        phone_e164: normalizedPhone,
        chat_id: targetChatId,
        reply_to_chat_id: targetChatId,
        reply_text: "Nomor ini sudah terhubung sebagai Owner Botseri.",
      });
    }

    // Invalid/expired/used code from unauthorized sender:
    // INV-07: Tidak dibalas, catat di system_events
    await recordEvent("WARN", "inbound", "inbound.invalid_pairing", {
      chat_id: targetChatId,
      phone_e164: normalizedPhone,
    });
    return response(false, "INVALID_PAIRING_CODE", null, targetChatId);
  }

  // 3. Check authorized numbers
  const authorized = await prisma.authorizedNumber.findFirst({
    where: {
      OR: [
        { phone_e164: normalizedPhone },
        { chat_id: targetChatId },
      ],
    },
  });

  if (authorized) {
    // 1. Nomor pengirim ada di authorized_numbers -> perilaku LAMA, role: OWNER
    if (input.from_me || input.fromMe === true) {
      return response(false, "FROM_ME_IGNORED", null, targetChatId);
    }

    // Inbound Rapid-Fire Cooldown untuk Owner
    const recentMsg = await prisma.messageLog.findFirst({
      where: { direction: "INBOUND", chat_id: targetChatId },
      orderBy: { created_at: "desc" },
    });
    if (
      recentMsg &&
      Date.now() - new Date(recentMsg.created_at).getTime() < 2000
    ) {
      return response(false, "INBOUND_COOLDOWN", null, targetChatId);
    }

    const countLastMinute = await prisma.messageLog.count({
      where: {
        direction: "INBOUND",
        chat_id: targetChatId,
        created_at: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (countLastMinute >= 6) {
      return response(false, "INBOUND_COOLDOWN", null, targetChatId);
    }

    const unsupported = input.has_media && input.media_type !== "audio";
    let message: MessageLog;
    try {
      message = await prisma.messageLog.create({
        data: {
          direction: "INBOUND",
          wa_message_id: input.wa_message_id,
          chat_id: targetChatId,
          body: unsupported ? null : input.body || null,
          media_type: input.media_type ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.messageLog.findUnique({
          where: { wa_message_id: input.wa_message_id },
        });
        return response(false, "DUPLICATE", existing?.id ?? null, targetChatId);
      }
      throw error;
    }

    if (unsupported) {
      return response(
        false,
        "UNSUPPORTED_MEDIA",
        message.id,
        targetChatId,
        "Maaf, untuk saat ini saya hanya bisa membaca pesan teks dan voice note.",
      );
    }

    return response(
      true,
      "OK",
      message.id,
      targetChatId,
      null,
      false,
      normalizedPhone,
      "OWNER",
    );
  }

  // JALUR BUKAN WHITELIST (Customer & Manual Owner Message)
  // 2. Pesan fromMe = true pada chat non-whitelist (D1)
  if (input.from_me || input.fromMe === true) {
    const partnerPhone =
      normalizePhoneE164(input.chat_id) ||
      normalizePhoneE164(input.from) ||
      normalizePhoneE164(targetChatId) ||
      normalizedPhone;

    if (looksLikeOrderForm(input.body ?? "")) {
      return response(
        true,
        "OK",
        null,
        targetChatId,
        null,
        false,
        null,
        "CUSTOMER",
        "SUBMIT_ORDER",
        partnerPhone,
      );
    }
    return response(false, "OWNER_MANUAL_MESSAGE", null, targetChatId);
  }

  // 3. Nomor tidak valid (normalizePhoneE164 = null)
  const validCustomerPhone = normalizePhoneE164(normalizedPhone);
  if (!validCustomerPhone) {
    return response(false, "INVALID_PHONE", null, targetChatId);
  }

  // 4. Pesan grup (chat id berakhiran @g.us)
  if (targetChatId.endsWith("@g.us") && (!gate.enabled || gate.ignore_groups)) {
    return response(false, "GROUP_IGNORED", null, targetChatId);
  }

  // 4b. Jika allow_unregistered_customers false, nomor bukan owner ditolak diam-diam
  if (gate.enabled && !gate.allow_unregistered_customers) {
    return response(false, "PUBLIC_CUSTOMER_DISABLED", null, targetChatId);
  }

  // 5. Pesan duplikat (id pesan sama dengan metadata.last_message_id)
  const customerSession = await prisma.customerSession.findUnique({
    where: { phone_e164: validCustomerPhone },
  });
  const sessionMeta = customerSession?.metadata as Record<string, unknown> | null;
  if (sessionMeta?.last_message_id === input.wa_message_id) {
    return response(false, "DUPLICATE", null, targetChatId);
  }

  // 6. Rate limit dari konfigurasi pipeline
  const maxRate = gate.enabled ? gate.rate_limit_per_minute : 20;
  const now = Date.now();
  const timestamps = (customerRateLimitMap.get(validCustomerPhone) || []).filter(
    (t) => now - t < 60_000,
  );
  if (timestamps.length >= maxRate) {
    return response(false, "RATE_LIMITED", null, targetChatId);
  }
  timestamps.push(now);
  customerRateLimitMap.set(validCustomerPhone, timestamps);

  // 7. Bot Mute Policy & Auto-Heal: Periksa pesanan aktif pelanggan
  const activeOrder = await prisma.order.findFirst({
    where: {
      OR: [
        { customer_contact: validCustomerPhone },
        { customer_contact: validCustomerPhone.replace(/^\+/, "") },
      ],
      status: {
        in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS],
      },
    },
    orderBy: { created_at: "desc" },
  });

  if (activeOrder && gate.enabled && gate.mute_bot_on_active_order) {
    return response(
      false,
      "ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED",
      null,
      targetChatId,
    );
  }

  // Auto-Heal: Jika activeOrder TIDAK ADA, pastikan sesi pelanggan tidak terkunci jeda
  if (!activeOrder) {
    await prisma.customerSession.updateMany({
      where: {
        phone_e164: { in: [validCustomerPhone, validCustomerPhone.replace(/^\+/, "")] },
        OR: [
          { paused_at: { not: null } },
          { state: "PAUSED_FOR_OWNER" },
        ],
      },
      data: {
        state: "ACTIVE",
        paused_at: null,
      },
    });
  }

  // 8. Selain itu -> accept: true, role: "CUSTOMER"
  const isOrder = looksLikeOrderForm(input.body ?? "");
  return response(
    true,
    "OK",
    null,
    targetChatId,
    null,
    false,
    null,
    "CUSTOMER",
    isOrder ? "SUBMIT_ORDER" : null,
    validCustomerPhone,
  );
}
