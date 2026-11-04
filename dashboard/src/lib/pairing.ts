import crypto from "node:crypto";

// Tanpa I, O, 0, 1 agar kode tidak salah dibaca dari layar.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const PAIRING_PATTERN = /^PAIR-[A-Z0-9]{6}$/;

export function generatePairingCode(): string {
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return `PAIR-${suffix}`;
}

// Pesan masuk dinormalisasi ke huruf besar, jadi hash selalu dari bentuk itu.
export function pairingHash(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
