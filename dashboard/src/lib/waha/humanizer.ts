import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import {
  sendSeen,
  sendTextDirect,
  startTyping,
  stopTyping,
} from "./client";

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
};

// Queue state
let queuePromise = Promise.resolve();

// Rate-limiting state
let lastSentAt = 0;
const sentTimestamps: number[] = [];

// Circuit breaker state
let consecutiveFailures = 0;
let cooldownUntil = 0;

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

async function checkRateLimits(chatId: string): Promise<void> {
  const now = Date.now();
  const window60s = now - 60_000;
  const window60m = now - 3_600_000;

  // Bersihkan data yang lebih tua dari 60 menit
  while (sentTimestamps.length > 0 && sentTimestamps[0] < window60m) {
    sentTimestamps.shift();
  }

  const count60s = sentTimestamps.filter((ts) => ts >= window60s).length;
  const count60m = sentTimestamps.length;

  if (count60s >= 4 || count60m >= 25) {
    await recordEvent(
      "WARN",
      "waha.antiban",
      "WAHA_RATE_LIMIT_BLOCKED",
      {
        chat_id: chatId,
        count_60s: count60s,
        count_60m: count60m,
      },
    );
    throw new HumanizerError(
      "WAHA_RATE_LIMIT_BLOCKED",
      429,
      `Batas pengiriman pesan tercapai (${count60s}/4 per menit, ${count60m}/25 per jam)`,
    );
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
    await recordEvent(
      "ERROR",
      "waha.antiban",
      "WAHA_CIRCUIT_BREAKER_TRIPPED",
      {
        chat_id: chatId,
        consecutive_failures: consecutiveFailures,
        is_restriction_error: isBanned,
        cooldown_minutes: 30,
        error: errorText.slice(0, 500),
      },
    );
  }
}

export async function sendHumanizedMessage(
  opts: HumanizeOptions,
): Promise<{ ok: boolean; response: unknown }> {
  // Enqueue ke serial outbound queue (Single-Flight Queue)
  const currentJob = async () => {
    // 1. Validasi penerima
    await validateRecipient(opts.chatId, Boolean(opts.isPairing));

    // 2. Cek Circuit Breaker
    checkCircuitBreaker();

    // 3. Cek Sliding-Window Rate Limiter
    await checkRateLimits(opts.chatId);

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

    // Step 5d: Stop typing & brief pause before send
    await stopTyping(opts.chatId);
    if (!bypass) {
      await sleep(randomBetween(200, 400));
    }

    // 6. Direct Send ke WAHA
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
  };

  // Jalankan secara serial
  const next = queuePromise.then(currentJob, currentJob);
  queuePromise = next.then(
    () => {},
    () => {},
  );
  return next;
}

// Helper untuk reset state saat pengujian otomatis
export function __resetHumanizerState(): void {
  lastSentAt = 0;
  sentTimestamps.length = 0;
  consecutiveFailures = 0;
  cooldownUntil = 0;
  queuePromise = Promise.resolve();
}
