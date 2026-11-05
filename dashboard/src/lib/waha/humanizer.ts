import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { maskChatId } from "@/lib/security/redact";
import { createDeferredPromise } from "@/lib/utils/promise";
import {
  sendSeen,
  sendTextDirect,
  startTyping,
  stopTyping,
} from "./client";
import { TRIGGER_PRIORITY, type Trigger } from "./triggers";

export class HumanizerError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HumanizerError";
  }
}

export type HumanizeOptions = {
  chatId: string;
  text: string;
  replyToWaMessageId?: string;
  isPairing?: boolean;
  skipDelay?: boolean;
  trigger?: Trigger;
  enqueuedAt?: number;
};

interface QueueItem {
  id: string;
  priority: 0 | 1 | 2;
  enqueuedAt: number;
  opts: HumanizeOptions;
  resolve: (value: { ok: boolean; response: unknown; skipped?: boolean }) => void;
  reject: (reason?: unknown) => void;
}

// Priority Queue state
const queue: QueueItem[] = [];
let isProcessing = false;

// Rate-limiting state
let lastSentAt = 0;
const sentTimestamps: number[] = [];

// Circuit breaker state
let consecutiveFailures = 0;
let cooldownUntil = 0;

export function getWahaCircuitBreakerStatus(now: Date = new Date()): {
  status: "NORMAL" | "COOLDOWN";
  cooldown_remaining_seconds: number;
  consecutive_failures: number;
} {
  const isCooldown = cooldownUntil > now.getTime();
  const remainingSeconds = isCooldown
    ? Math.max(0, Math.ceil((cooldownUntil - now.getTime()) / 1000))
    : 0;
  return {
    status: isCooldown ? "COOLDOWN" : "NORMAL",
    cooldown_remaining_seconds: remainingSeconds,
    consecutive_failures: consecutiveFailures,
  };
}

export function calculateTypingDuration(
  text: string,
  randomFn = Math.random,
): number {
  const cpmFactor = 35 + randomFn() * 25; // 35 - 60 ms per karakter
  const raw = Math.round(text.length * cpmFactor);
  return Math.max(1500, Math.min(raw, 7500));
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isFastTest(): boolean {
  return process.env.WAHA_FAST_TEST === "1";
}

async function validateRecipient(
  chatId: string,
  isPairing: boolean,
): Promise<void> {
  if (
    chatId.endsWith("@g.us") ||
    chatId.includes("@newsletter") ||
    chatId === "status@broadcast" ||
    chatId.includes("@broadcast")
  ) {
    throw new HumanizerError(
      "NON_PERSONAL_CHAT_FORBIDDEN",
      400,
      "Dilarang mengirim pesan ke grup, newsletter, atau broadcast",
    );
  }

  if (isPairing) return;

  const digits = chatId.replace(/\D/g, "");
  const authorized =
    (await prisma.authorizedNumber.findUnique({
      where: { chat_id: chatId },
    })) ??
    (chatId.endsWith("@c.us")
      ? await prisma.authorizedNumber.findUnique({
          where: { phone_e164: `+${chatId.replace(/@c\.us$/, "")}` },
        })
      : null) ??
    (typeof prisma.authorizedNumber.findFirst === "function"
      ? await prisma.authorizedNumber.findFirst({
          where: {
            OR: [
              { phone_e164: `+${digits}` },
              { phone_e164: digits },
              { chat_id: `${digits}@c.us` },
              { chat_id: chatId },
            ],
          },
        })
      : null);
  if (!authorized) {
    const isCustomer =
      (prisma.customerSession?.findUnique
        ? await prisma.customerSession.findUnique({
            where: { phone_e164: `+${digits}` },
          })
        : null) ??
      (typeof prisma.customerSession?.findFirst === "function"
        ? await prisma.customerSession.findFirst({
            where: {
              OR: [
                { phone_e164: `+${digits}` },
                { phone_e164: digits },
              ],
            },
          })
        : null);

    if (!isCustomer) {
      throw new HumanizerError(
        "UNAUTHORIZED_RECIPIENT",
        403,
        "Nomor tujuan tidak terdaftar di authorized_numbers maupun customer_sessions",
      );
    }
  }
}

async function checkRateLimits(
  chatId: string,
  priority: 0 | 1 | 2,
  opts?: HumanizeOptions,
): Promise<void> {
  const now = Date.now();
  const window60s = now - 60_000;
  const window60m = now - 3_600_000;

  // Bersihkan data yang lebih tua dari 60 menit
  while (sentTimestamps.length > 0 && sentTimestamps[0] < window60m) {
    sentTimestamps.shift();
  }

  let count60s = sentTimestamps.filter((ts) => ts >= window60s).length;
  let count60m = sentTimestamps.length;

  // Reservasi Kuota:
  // Batas 4/menit: P0 boleh pakai slot ke-4, P1/P2 maksimal 3 slot/menit (1 slot direservasi untuk P0)
  // Batas 25/jam: P0 boleh pakai hingga 25, P1/P2 maksimal 20/jam (5 slot direservasi untuk P0)
  const maxMinute = priority === 0 ? 4 : 3;
  const maxHour = priority === 0 ? 25 : 20;

  // Jika kuota jendela 60s sedang penuh, tahan eksekusi secara asinkron hingga slot jendela waktu tersedia
  if (count60s >= maxMinute && !isFastTest() && !opts?.skipDelay) {
    const oldestIn60s = sentTimestamps.filter((ts) => ts >= window60s)[0];
    const waitMs = oldestIn60s ? Math.max(500, oldestIn60s + 60_000 - Date.now() + 250) : 1500;
    if (waitMs > 0 && waitMs <= 30_000) {
      await sleep(waitMs);
      const updatedNow = Date.now();
      const updatedWindow60s = updatedNow - 60_000;
      count60s = sentTimestamps.filter((ts) => ts >= updatedWindow60s).length;
      count60m = sentTimestamps.length;
    }
  }
  if (count60s >= maxMinute || count60m >= maxHour) {
    await recordEvent(
      "WARN",
      "waha.antiban",
      "WAHA_RATE_LIMIT_BLOCKED",
      {
        chat_id: maskChatId(chatId),
        priority,
        count_60s: count60s,
        count_60m: count60m,
        max_minute: maxMinute,
        max_hour: maxHour,
      },
    );
    throw new HumanizerError(
      "WAHA_RATE_LIMIT_BLOCKED",
      429,
      `Batas pengiriman pesan tercapai (${count60s}/4 per menit, ${count60m}/25 per jam)`,
    );
  }

  // Batas per pelanggan: maksimal 12 pesan per jam per chat_id pelanggan
  if (priority === 2 && typeof prisma.messageLog?.count === "function") {
    const customerOutboundCount = await prisma.messageLog.count({
      where: {
        direction: "OUTBOUND",
        chat_id: chatId,
        created_at: { gte: new Date(Date.now() - 3600_000) },
      },
    });
    if (customerOutboundCount >= 12) {
      await recordEvent("WARN", "waha.antiban", "CUSTOMER_HOURLY_LIMIT_BLOCKED", {
        chat_id: maskChatId(chatId),
        count: customerOutboundCount,
      });
      throw new HumanizerError(
        "CUSTOMER_HOURLY_LIMIT_BLOCKED",
        429,
        "Batas pengiriman pesan ke pelanggan tercapai (12 pesan per jam)",
      );
    }
  }
}

function checkCircuitBreaker(): void {
  const now = Date.now();
  if (now < cooldownUntil) {
    const remainingSeconds = Math.ceil((cooldownUntil - now) / 1000);
    throw new HumanizerError(
      "WAHA_CIRCUIT_BREAKER_OPEN",
      503,
      `Circuit breaker WAHA aktif selama ${remainingSeconds} detik lagi`,
    );
  }
}

async function handleCircuitFailure(
  chatId: string,
  errorText: string,
): Promise<void> {
  consecutiveFailures += 1;
  const isBanned =
    errorText.toLowerCase().includes("restricted") ||
    errorText.toLowerCase().includes("banned") ||
    errorText.toLowerCase().includes("spam");

  if (consecutiveFailures >= 3 || isBanned) {
    cooldownUntil = Date.now() + 30 * 60 * 1000; // 30 menit cooldown
    try {
      await prisma.runtimeFlag.upsert({
        where: { key: "waha_circuit_breaker" },
        create: {
          key: "waha_circuit_breaker",
          value_json: {
            status: "COOLDOWN",
            cooldown_until: cooldownUntil,
            consecutive_failures: consecutiveFailures,
          },
        },
        update: {
          value_json: {
            status: "COOLDOWN",
            cooldown_until: cooldownUntil,
            consecutive_failures: consecutiveFailures,
          },
        },
      });
    } catch {
      // Abaikan jika DB belum siap
    }

    await recordEvent(
      "ERROR",
      "waha.antiban",
      "WAHA_CIRCUIT_BREAKER_TRIPPED",
      {
        chat_id: maskChatId(chatId),
        consecutive_failures: consecutiveFailures,
        is_restriction_error: isBanned,
        cooldown_minutes: 30,
        error: errorText.slice(0, 500),
      },
    );
  }
}

export async function resetWahaCircuitBreaker(): Promise<void> {
  consecutiveFailures = 0;
  cooldownUntil = 0;
  try {
    await prisma.runtimeFlag.upsert({
      where: { key: "waha_circuit_breaker" },
      create: {
        key: "waha_circuit_breaker",
        value_json: {
          status: "NORMAL",
          cooldown_until: 0,
          consecutive_failures: 0,
        },
      },
      update: {
        value_json: {
          status: "NORMAL",
          cooldown_until: 0,
          consecutive_failures: 0,
        },
      },
    });
  } catch {
    // Abaikan jika DB belum siap
  }
}

export async function initWahaGuardFromPersistence(): Promise<void> {
  try {
    const flag = await prisma.runtimeFlag.findUnique({
      where: { key: "waha_circuit_breaker" },
    });
    if (flag && flag.value_json && typeof flag.value_json === "object") {
      const val = flag.value_json as Record<string, unknown>;
      if (typeof val.cooldown_until === "number" && val.cooldown_until > Date.now()) {
        cooldownUntil = val.cooldown_until;
      }
      if (typeof val.consecutive_failures === "number") {
        consecutiveFailures = val.consecutive_failures;
      }
    }

    // Lazy Init Rate Limiter Outbound
    const oneHourAgo = new Date(Date.now() - 3600_000);
    const recentOutbound = await prisma.messageLog.findMany({
      where: {
        direction: "OUTBOUND",
        created_at: { gte: oneHourAgo },
      },
      select: { created_at: true },
    });
    for (const m of recentOutbound) {
      sentTimestamps.push(new Date(m.created_at).getTime());
    }
  } catch {
    // Abaikan jika DB belum siap
  }
}

async function executeSendMessage(
  opts: HumanizeOptions,
  priority: 0 | 1 | 2,
): Promise<{ ok: boolean; response: unknown }> {
  // 1. Validasi penerima
  await validateRecipient(opts.chatId, Boolean(opts.isPairing));

  // 2. Cek Circuit Breaker
  checkCircuitBreaker();

  // 3. Cek Sliding-Window Rate Limiter & Reservasi Kuota
  await checkRateLimits(opts.chatId, priority, opts);

  const bypass = opts.skipDelay || isFastTest();

  // 4. Minimum Inter-Message Spacing (6000ms + random jitter 0-2500ms)
  const now = Date.now();
  const elapsed = now - lastSentAt;
  const requiredGap = bypass ? 0 : 6000 + randomBetween(0, 2500);
  if (!bypass && elapsed < requiredGap) {
    await sleep(requiredGap - elapsed);
  }

  // 5. Human Presence Simulation
  // Step 5a: Read delay & sendSeen jika ini balasan chat
  if (opts.replyToWaMessageId) {
    if (!bypass) {
      await sleep(randomBetween(800, 1800));
    }
    await sendSeen(opts.chatId, opts.replyToWaMessageId);
  }

  // Step 5b: Start typing
  await startTyping(opts.chatId);

  // Step 5c: Typing duration
  const typingDuration = bypass
    ? 0
    : calculateTypingDuration(opts.text);
  if (typingDuration > 0) {
    await sleep(typingDuration);
  }

  // Step 5d: Stop typing
  await stopTyping(opts.chatId);

  // 6. Kirim pesan ke WAHA upstream
  let upstreamRes: Response;
  if (process.env.WAHA_MOCK_OUTBOUND === "1") {
    upstreamRes = new Response(
      JSON.stringify({ id: `mock-wa-msg-${Date.now()}` }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } else {
    try {
      upstreamRes = await sendTextDirect(
        opts.chatId,
        opts.text,
        opts.replyToWaMessageId,
      );
    } catch (netErr) {
      const errMsg =
        netErr instanceof Error ? netErr.message : "Network error";
      await handleCircuitFailure(opts.chatId, errMsg);
      throw new HumanizerError(
        "WAHA_UPSTREAM_ERROR",
        502,
        `Gagal menghubungi WAHA: ${errMsg}`,
      );
    }
  }
  if (!upstreamRes.ok && opts.replyToWaMessageId) {
    // Fallback kirim langsung tanpa replyTo jika WAHA menolak format message ID yang di-quote
    try {
      const fallbackRes = await sendTextDirect(opts.chatId, opts.text);
      if (fallbackRes.ok) {
        upstreamRes = fallbackRes;
      }
    } catch {
      // Pertahankan respon awal jika fallback juga gagal
    }
  }

  const bodyText = await upstreamRes.text();
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = bodyText;
  }

  if (!upstreamRes.ok) {
    await handleCircuitFailure(opts.chatId, bodyText);
    throw new HumanizerError(
      "WAHA_SEND_FAILED",
      upstreamRes.status,
      `WAHA sendText mengembalikan error ${upstreamRes.status}: ${bodyText.slice(0, 300)}`,
    );
  }

  // Reset circuit failures on success
  consecutiveFailures = 0;
  lastSentAt = Date.now();
  sentTimestamps.push(lastSentAt);

  return { ok: true, response: bodyJson };
}

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (queue.length > 0) {
      // Urutkan prioritas: P0 sebelum P1 sebelum P2. Dalam prioritas sama, FIFO
      queue.sort((a, b) => a.priority - b.priority);
      const item = queue.shift()!;

      // Pembersihan Pesan Basi (P2 TTL Guard: 120 detik)
      if (item.priority === 2 && Date.now() - item.enqueuedAt > 120_000) {
        await recordEvent("WARN", "waha.queue", "WAHA_QUEUE_EXPIRED", {
          chat_id: maskChatId(item.opts.chatId),
          enqueued_at: item.enqueuedAt,
          trigger: item.opts.trigger,
        });
        item.resolve({
          ok: false,
          response: null,
          skipped: true,
        });
        continue;
      }

      try {
        const result = await executeSendMessage(item.opts, item.priority);
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }
  } finally {
    isProcessing = false;
    if (queue.length > 0) {
      void processQueue();
    }
  }
}

export function sendHumanizedMessage(
  opts: HumanizeOptions,
): Promise<{ ok: boolean; response: unknown; skipped?: boolean }> {
  const { promise, resolve, reject } = createDeferredPromise<{
    ok: boolean;
    response: unknown;
    skipped?: boolean;
  }>();

  const trigger = opts.trigger;
  const priority = trigger ? (TRIGGER_PRIORITY[trigger] ?? 2) : (opts.isPairing ? 0 : 2);
  const enqueuedAt = opts.enqueuedAt ?? Date.now();

  const item: QueueItem = {
    id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    priority,
    enqueuedAt,
    opts,
    resolve,
    reject,
  };

  queue.push(item);
  queue.sort((a, b) => a.priority - b.priority);

  void processQueue();
  return promise;
}

// Helper untuk reset state saat pengujian otomatis
export function __resetHumanizerState(state?: { sentTimestamps?: number[] }): void {
  lastSentAt = 0;
  sentTimestamps.length = 0;
  if (state?.sentTimestamps) {
    sentTimestamps.push(...state.sentTimestamps);
  }
  consecutiveFailures = 0;
  cooldownUntil = 0;
  queue.length = 0;
  isProcessing = false;
}
