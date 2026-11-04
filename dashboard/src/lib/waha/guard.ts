/**
 * Deterministic Output Guard for WhatsApp messages (Step 06 & Hotfix)
 * Enforces Latin script only, repetition bounds, and mode length caps.
 */

export const NON_LATIN_SCRIPT_REGEX = /[\u0E00-\u0E7F\u4E00-\u9FFF\u0600-\u06FF]/;
export const MAX_REPEATED_CHAR = 8;
export const REPEATED_CHAR_REGEX = new RegExp(`(.)\\1{${MAX_REPEATED_CHAR - 1},}`);
export const CHAT_MASUK_MAX_LENGTH = 1500;

export type GuardResult = {
  valid: boolean;
  reason?: string;
  fallbackText?: string;
};

export const FALLBACK_INVALID_REPLY =
  "Maaf, balasan saya tidak valid. Mohon ulangi pesan Anda.";

export function validateAgentOutput(
  text: string,
  triggerType?: string,
  userMessage?: string,
): GuardResult {
  if (!text || typeof text !== "string" || !text.trim()) {
    return {
      valid: false,
      reason: "EMPTY_TEXT",
      fallbackText: "Halo! Ada tugas atau catatan baru yang ingin ditambahkan hari ini?",
    };
  }

  // Check if non-Latin characters originated from the user themselves
  const userHasNonLatin = userMessage ? NON_LATIN_SCRIPT_REGEX.test(userMessage) : false;

  // 1. Non-Latin scripts check (Thai, CJK, Arabic) unless user wrote it
  if (!userHasNonLatin && NON_LATIN_SCRIPT_REGEX.test(text)) {
    return {
      valid: false,
      reason: "NON_LATIN_SCRIPT",
      fallbackText: FALLBACK_INVALID_REPLY,
    };
  }

  // 2. Repetition loops check (8+ repeated identical characters, e.g. '''''''' or ========)
  if (REPEATED_CHAR_REGEX.test(text)) {
    return {
      valid: false,
      reason: "REPETITION_LOOP",
      fallbackText: FALLBACK_INVALID_REPLY,
    };
  }

  // 3. Mode length cap (scoped to CHAT_MASUK; briefs and evals have higher limits)
  if (triggerType === "CHAT_MASUK" && text.length > CHAT_MASUK_MAX_LENGTH) {
    return {
      valid: false,
      reason: "EXCEEDS_LENGTH_CAP",
      fallbackText: FALLBACK_INVALID_REPLY,
    };
  }

  return { valid: true };
}
