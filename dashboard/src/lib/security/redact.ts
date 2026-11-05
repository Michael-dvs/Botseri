/**
 * Utilitas Redaksi PII & Masking Log untuk Privasi Pelanggan (S12 §3).
 * Menyamarkan data pribadi sebelum dikirim ke LLM dan dalam pencatatan log audit.
 */

const INDONESIA_PHONE_REGEX = /(?:\+?62|0)8[1-9][0-9]{7,11}\b/g;
const EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;

/**
 * Menyamarkan nomor telepon dan alamat email dalam teks pelanggan sebelum dikirim ke LLM.
 */
export function redactForLlm(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(EMAIL_REGEX, "[EMAIL]")
    .replace(INDONESIA_PHONE_REGEX, "[NOMOR_TELEPON]");
}

/**
 * Menyamarkan digit tengah nomor telepon untuk log audit atau tampilan antarmuka.
 * Contoh: 081234567890 -> 0812****7890, +6281234567890 -> +62812****7890.
 */
export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== "string") return "";
  const trimmed = phone.trim();
  if (trimmed.length < 8) return trimmed;

  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length < 8) return trimmed;

  const prefixLen = trimmed.startsWith("+62") ? 6 : trimmed.startsWith("08") ? 4 : 4;
  const suffixLen = 4;

  if (trimmed.length <= prefixLen + suffixLen) return trimmed;

  const prefix = trimmed.slice(0, prefixLen);
  const suffix = trimmed.slice(-suffixLen);

  return `${prefix}****${suffix}`;
}

/**
 * Menyamarkan ID chat WhatsApp pengguna pribadi (@c.us), grup (@g.us) dibiarkan utuh.
 * Contoh: 6281234567890@c.us -> 62812****7890@c.us.
 */
export function maskChatId(chatId: string): string {
  if (!chatId || typeof chatId !== "string") return "";
  if (chatId.endsWith("@g.us")) return chatId;

  const atIndex = chatId.indexOf("@");
  if (atIndex === -1) return maskPhone(chatId);

  const userPart = chatId.slice(0, atIndex);
  const domainPart = chatId.slice(atIndex);

  if (userPart.length < 8) return chatId;

  const prefix = userPart.slice(0, 5);
  const suffix = userPart.slice(-4);

  return `${prefix}****${suffix}${domainPart}`;
}
