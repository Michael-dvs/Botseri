/**
 * Phone number normalization and sender resolution utilities for Botseri.
 * Enforces strict E.164 compliance (+[1-9][0-9]{6,14}) for WhatsApp identifiers.
 */

/**
 * Normalizes a raw phone number or WhatsApp JID to E.164 format (+<digits>).
 *
 * Rules:
 * - Strips JID suffixes (@c.us, @s.whatsapp.net).
 * - Strips device suffixes (e.g. :12).
 * - Strips whitespace, dashes, dots, and parentheses.
 * - Rejects opaque IDs (@lid), groups (@g.us), broadcast/channels (@newsletter, @broadcast).
 * - Rejects any string with mixed letters or illegal characters.
 * - Rejects numbers that lack a country code (e.g. leading 0) because WAHA delivers
 *   WhatsApp identifiers with country codes (never with national trunk prefixes like 0).
 * - Validates E.164 length: 7 to 15 digits after '+', first digit 1-9.
 */
export function normalizeToE164(raw: string | undefined | null): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject opaque @lid, group JIDs, broadcasts, and newsletters
  if (
    trimmed.includes("@lid") ||
    trimmed.includes("@g.us") ||
    trimmed.includes("@broadcast") ||
    trimmed.includes("@newsletter")
  ) {
    return null;
  }

  // Strip known WhatsApp JID suffixes
  let s = trimmed
    .replace(/@c\.us$/i, "")
    .replace(/@s\.whatsapp\.net$/i, "");

  // If another @ remains, this is not a valid WhatsApp user JID
  if (s.includes("@")) return null;

  // Strip device suffix (e.g. :12 or :0)
  s = s.replace(/:[0-9]+$/, "");

  // If any alphabetic character is present, reject immediately
  if (/[a-zA-Z]/.test(s)) return null;

  // Remove standard formatting punctuation: spaces, dashes, dots, parentheses
  const cleaned = s.replace(/[\s\-\.\(\)]/g, "");

  // Extract digits and optional leading plus
  const hasLeadingPlus = cleaned.startsWith("+");
  const digits = hasLeadingPlus ? cleaned.slice(1) : cleaned;

  // Digits must be purely numeric
  if (!/^\d+$/.test(digits)) return null;

  // E.164 check: first digit must be 1-9 (country code, no leading trunk 0), length 7-15 digits
  // WAHA always delivers numbers with country codes (e.g. 628123... in Indonesia).
  // Numbers starting with 0 are local national numbers missing their country code.
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;

  return `+${digits}`;
}

/**
 * Checks whether an identifier is an opaque WhatsApp LID (@lid).
 */
export function isLidIdentifier(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  return trimmed.endsWith("@lid") || trimmed.includes("@lid");
}

export interface SenderPayloadCandidates {
  participant?: string | null;
  remote_jid_alt?: string | null;
  remoteJidAlt?: string | null;
  sender_pn?: string | null;
  senderPn?: string | null;
  author?: string | null;
  phone_e164?: string | null;
  phone?: string | null;
  sender?: string | null;
  from?: string | null;
  chat_id?: string | null;
  chatId?: string | null;
  _data?: {
    key?: {
      remoteJid?: string | null;
      remoteJidAlt?: string | null;
      senderPn?: string | null;
      participant?: string | null;
      [key: string]: unknown;
    };
    author?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/**
 * Checks whether any sender field in the payload was an opaque @lid identifier.
 */
export function isLidSender(payload: SenderPayloadCandidates): boolean {
  const fields = [
    payload.from,
    payload.chat_id,
    payload.chatId,
    payload.sender,
    payload.remote_jid_alt,
    payload.remoteJidAlt,
    payload._data?.key?.remoteJid,
  ];
  return fields.some((f) => typeof f === "string" && isLidIdentifier(f));
}

/**
 * Extracts the raw LID string if present.
 */
export function getLidIdentifier(payload: SenderPayloadCandidates): string | null {
  const fields = [
    payload.from,
    payload.chat_id,
    payload.chatId,
    payload.sender,
    payload._data?.key?.remoteJid,
  ];
  for (const f of fields) {
    if (typeof f === "string" && isLidIdentifier(f)) {
      return f.trim();
    }
  }
  return null;
}

/**
 * Resolves the sender's E.164 phone number from inbound payload candidates in strict priority order:
 * 1. participant / _data.key.participant (group context)
 * 2. remote_jid_alt / remoteJidAlt / _data.key.remoteJidAlt (WAHA NOWEB alternate phone JID for @lid senders)
 * 3. sender_pn / senderPn / _data.key.senderPn (explicit phone number in LID mode)
 * 4. phone_e164 (explicit normalized phone)
 * 5. phone (explicit phone)
 * 6. author / _data.author (message author)
 * 7. sender (explicit sender)
 * 8. from (standard message sender)
 * 9. chat_id / chatId (fallback to chat identifier)
 */
export function resolveSenderE164(payload: SenderPayloadCandidates): string | null {
  const candidates: Array<string | null | undefined> = [
    payload.participant,
    payload._data?.key?.participant,
    payload.remote_jid_alt,
    payload.remoteJidAlt,
    payload._data?.key?.remoteJidAlt,
    payload.sender_pn,
    payload.senderPn,
    payload._data?.key?.senderPn,
    payload.phone_e164,
    payload.phone,
    payload.author,
    payload._data?.author,
    payload.sender,
    payload.from,
    payload.chat_id,
    payload.chatId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const normalized = normalizeToE164(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}
