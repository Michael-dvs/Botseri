import { normalizeToE164 } from "@/lib/phone";
const baseUrl = () =>
  (process.env.WAHA_URL ?? "http://botseri-waha:3000").replace(/\/$/, "");
const apiKey = () => process.env.WAHA_API_KEY ?? "";
const session = () => process.env.WAHA_SESSION ?? "default";

export async function wahaFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "X-Api-Key": apiKey(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

export async function getSessionStatus(): Promise<{
  status: string;
  raw?: unknown;
}> {
  try {
    const response = await wahaFetch(
      `/api/sessions/${encodeURIComponent(session())}`,
    );
    if (!response.ok) return { status: "UNKNOWN" };
    const raw: unknown = await response.json();
    let status = "UNKNOWN";
    if (
      raw &&
      typeof raw === "object" &&
      "status" in raw &&
      typeof raw.status === "string"
    ) {
      status = raw.status;
    }
    return { status, raw };
  } catch {
    return { status: "UNREACHABLE" };
  }
}

export async function getQrImage(): Promise<Response> {
  return wahaFetch(
    `/api/${encodeURIComponent(session())}/auth/qr?format=image`,
    {
      headers: { Accept: "image/png" },
    },
  );
}

export async function startSession(): Promise<Response> {
  const current = await getSessionStatus();
  // Jika sesi dalam status FAILED atau STOPPED, restart sesi agar kembali ke SCAN_QR_CODE
  if (current.status === "FAILED" || current.status === "STOPPED") {
    const restartRes = await restartSession();
    if (restartRes.ok) return restartRes;
  }

  // Coba start sesi yang ada
  const startRes = await wahaFetch(
    `/api/sessions/${encodeURIComponent(session())}/start`,
    { method: "POST" },
  );
  if (startRes.ok) return startRes;

  if (startRes.status === 404) {
    return wahaFetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: session() }),
    });
  }

  return restartSession();
}

export async function stopSession(): Promise<Response> {
  return wahaFetch(
    `/api/sessions/${encodeURIComponent(session())}/stop`,
    { method: "POST" },
  );
}

export async function restartSession(): Promise<Response> {
  return wahaFetch(
    `/api/sessions/${encodeURIComponent(session())}/restart`,
    { method: "POST" },
  );
}

export async function logoutSession(): Promise<Response> {
  return wahaFetch(
    `/api/sessions/${encodeURIComponent(session())}/logout`,
    { method: "POST" },
  );
}

export async function requestCode(phoneNumber: string): Promise<Response> {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  return wahaFetch(
    `/api/${encodeURIComponent(session())}/auth/request-code`,
    {
      method: "POST",
      body: JSON.stringify({ phoneNumber: cleanPhone }),
    },
  );
}
export async function sendSeen(
  chatId: string,
  messageId?: string,
): Promise<boolean> {
  try {
    const res = await wahaFetch("/api/sendSeen", {
      method: "POST",
      body: JSON.stringify({
        session: session(),
        chatId,
        messageId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startTyping(chatId: string): Promise<boolean> {
  try {
    const res = await wahaFetch("/api/startTyping", {
      method: "POST",
      body: JSON.stringify({
        session: session(),
        chatId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function stopTyping(chatId: string): Promise<boolean> {
  try {
    const res = await wahaFetch("/api/stopTyping", {
      method: "POST",
      body: JSON.stringify({
        session: session(),
        chatId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTextDirect(
  chatId: string,
  text: string,
  replyTo?: string,
): Promise<Response> {
  return wahaFetch("/api/sendText", {
    method: "POST",
    body: JSON.stringify({
      session: session(),
      chatId,
      text,
      reply_to: replyTo,
    }),
  });
}
export async function downloadMediaBuffer(mediaUrl: string): Promise<Buffer> {
  const res = await fetch(mediaUrl, {
    headers: {
      "X-Api-Key": apiKey(),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Gagal mengunduh media dari WAHA: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
export async function lookupLidContact(lid: string): Promise<string | null> {
  try {
    const res = await wahaFetch(
      `/api/contacts/get?contactId=${encodeURIComponent(lid)}&session=${encodeURIComponent(session())}`,
    );
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        id?: string;
        number?: string;
        pn?: string;
      } | null;
      if (data) {
        const raw = data.number || data.pn || data.id;
        return normalizeToE164(raw);
      }
    }
  } catch {
    // Non-blocking fallback
  }
  return null;
}

export const wahaSessionName = session;
