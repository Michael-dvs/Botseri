/**
 * Modul pembersihan dan sanitasi data tidak tepercaya (INV-14).
 * Mencegah Prompt Injection dan eksfiltrasi data dari input bebas pelanggan.
 */

export interface SanitizeOptions {
  maxLen?: number;
}

export interface UntrustedCustomerText {
  text: string;
  untrusted: true;
}

/**
 * Membersihkan teks bebas dari pelanggan:
 * 1. Menghapus karakter kontrol (ASCII 0-31 dan 127) serta karakter zero-width.
 * 2. Menormalkan spasi berturut-turut menjadi spasi tunggal dan melakukan trim.
 * 3. Menetralkan pola triple backtick (```) agar tidak memecah konteks markdown.
 * 4. Menetralkan tag peran prompt injection (<system>, [INST], ###, dll.).
 * 5. Memotong teks hingga batas maksimal (default 300 karakter).
 */
export function sanitizeUntrusted(
  text: string | null | undefined,
  options: SanitizeOptions = {}
): string {
  if (text === null || text === undefined) return "";
  const maxLen = typeof options.maxLen === "number" && options.maxLen > 0 ? options.maxLen : 300;
  let cleaned = String(text);

  // 1. Buang karakter zero-width (\u200B s.d. \u200D, \uFEFF, \u2060, dll.)
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u2060\u180E]/g, "");

  // 2. Buang karakter kontrol ASCII (0-8, 11-12, 14-31, 127) dan konversi newline/tab ke spasi
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  cleaned = cleaned.replace(/[\r\n\t]/g, " ");

  // 3. Netralkan pola triple backtick (``` -> ''')
  cleaned = cleaned.replace(/```/g, "'''");

  // 4. Netralkan tag peran prompt injection umum
  cleaned = cleaned
    .replace(/<\/?system>/gi, (m) => `(${m.replace(/[<>]/g, "")})`)
    .replace(/<\/?user>/gi, (m) => `(${m.replace(/[<>]/g, "")})`)
    .replace(/<\/?assistant>/gi, (m) => `(${m.replace(/[<>]/g, "")})`)
    .replace(/\[\/?INST\]/gi, (m) => `(${m.replace(/[[\]]/g, "")})`)
    .replace(/#{3,}/g, "##");

  // 5. Normalisasi spasi dan trim
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 6. Potong hingga batas maxLen
  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, maxLen).trim();
  }

  return cleaned;
}

/**
 * Membungkus teks pelanggan ke dalam field bertanda untrusted: true.
 */
export function wrapCustomerText(
  text: string | null | undefined,
  maxLen = 300
): UntrustedCustomerText {
  return {
    text: sanitizeUntrusted(text, { maxLen }),
    untrusted: true,
  };
}
