import { normalizeToE164 } from "@/lib/phone";

/**
 * Normalizes a raw phone number or WhatsApp JID to E.164 (+<digits>).
 * Handles Indonesian local leading '0' (e.g. 08123... -> +628123...).
 * Returns null if invalid or cannot be normalized.
 */
export function normalizePhoneE164(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject explicit opaque identifiers or non-user JIDs
  if (
    trimmed.includes("@lid") ||
    trimmed.includes("@g.us") ||
    trimmed.includes("@broadcast") ||
    trimmed.includes("@newsletter")
  ) {
    return null;
  }

  // Strip WhatsApp domain suffix and device suffix
  const s = trimmed
    .replace(/@(c\.us|s\.whatsapp\.net)$/i, "")
    .replace(/:[0-9]+$/, "");

  // If another @ remains or letters exist, reject
  if (s.includes("@") || /[a-zA-Z]/.test(s)) {
    return null;
  }

  // Strip formatting spaces, dashes, dots, parentheses
  const cleaned = s.replace(/[\s\-\.\(\)]/g, "");
  if (!cleaned) return null;

  let candidate = cleaned;
  if (candidate.startsWith("+0")) {
    candidate = "+62" + candidate.slice(2);
  } else if (candidate.startsWith("0")) {
    candidate = "62" + candidate.slice(1);
  }

  return normalizeToE164(candidate);
}
