
/**
 * Normalizes a raw phone number or WhatsApp JID to pure E.164 digits without plus (e.g. 628123456789).
 * Converts 08xx -> 628xx, +628xx -> 628xx, 8xx -> 628xx.
 * Strips formatting (+, spaces, dashes, dots, parentheses, @c.us suffix, device suffixes).
 * Returns null if invalid or cannot be normalized.
 */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject groups, broadcasts, newsletters
  if (
    trimmed.includes("@g.us") ||
    trimmed.includes("@broadcast") ||
    trimmed.includes("@newsletter")
  ) {
    return null;
  }

  // Handle @lid specifically
  if (trimmed.includes("@lid")) {
    const lidDigits = trimmed.replace(/@lid$/i, "").replace(/:[0-9]+$/, "").trim();
    return /^\d{8,16}$/.test(lidDigits) ? lidDigits : null;
  }

  // Strip WhatsApp domain suffix and device suffix
  const s = trimmed
    .replace(/@(c\.us|s\.whatsapp\.net)$/i, "")
    .replace(/:[0-9]+$/, "");

  // If another @ remains or letters exist, reject
  if (s.includes("@") || /[a-zA-Z]/.test(s)) {
    return null;
  }

  // Strip formatting spaces, dashes, dots, parentheses, plus
  const cleaned = s.replace(/[\s\-\.\(\)\+]/g, "");
  if (!cleaned) return null;

  let candidate = cleaned;
  if (candidate.startsWith("0")) {
    candidate = "62" + candidate.slice(1);
  } else if (candidate.startsWith("8") && candidate.length >= 9 && candidate.length <= 13) {
    candidate = "62" + candidate;
  }

  if (!/^\d{8,16}$/.test(candidate)) {
    return null;
  }

  return candidate;
}

/**
 * Converts a phone number or JID to proper WhatsApp Chat ID (<digits>@c.us).
 */
export function toChatId(phone: string | undefined | null): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  if (trimmed.endsWith("@c.us") || trimmed.endsWith("@lid") || trimmed.endsWith("@g.us")) {
    return trimmed;
  }

  const normalized = normalizePhone(trimmed);
  if (normalized) {
    return `${normalized}@c.us`;
  }

  const digits = trimmed.replace(/\D/g, "");
  return digits ? `${digits}@c.us` : "";
}

/**
 * Normalizes a raw phone number or WhatsApp JID to E.164 (+<digits>).
 * Handles Indonesian local leading '0' (e.g. 08123... -> +628123...).
 * Returns null if invalid or cannot be normalized.
 */
export function normalizePhoneE164(raw: string | undefined | null): string | null {
  const norm = normalizePhone(raw);
  if (!norm) return null;
  return `+${norm}`;
}
