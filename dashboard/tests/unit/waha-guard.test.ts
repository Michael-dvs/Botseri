import { describe, expect, it } from "vitest";
import {
  validateAgentOutput,
  FALLBACK_INVALID_REPLY,
  NON_LATIN_SCRIPT_REGEX,
  CHAT_MASUK_MAX_LENGTH,
} from "../../src/lib/waha/guard";

describe("Deterministic Output Guard (validateAgentOutput)", () => {
  it("passes normal Indonesian text with emoji", () => {
    const text = "Siap, sudah dicatat! ✅\n1. Kirim bunga mawar · Jumat 23 Okt, 10.00 WIB (prioritas 1)";
    const res = validateAgentOutput(text, "CHAT_MASUK");
    expect(res.valid).toBe(true);
  });

  it("provides friendly fallback when agent output is empty", () => {
    const res = validateAgentOutput("", "CHAT_MASUK");
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("EMPTY_TEXT");
    expect(res.fallbackText).toBe("Halo! Ada tugas atau catatan baru yang ingin ditambahkan hari ini?");
  });

  it("rejects text containing Thai characters and provides fallback", () => {
    const text = "cuma menambahulinันเงินไทยฟรี yang harus Anda kerjakan dua kali";
    const res = validateAgentOutput(text, "CHAT_MASUK");
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("NON_LATIN_SCRIPT");
    expect(res.fallbackText).toBe(FALLBACK_INVALID_REPLY);
  });

  it("rejects text containing Chinese (CJK) characters", () => {
    const text = "tidak ada duplikasi jadwal atau从业 timer sia-sia";
    const res = validateAgentOutput(text, "CHAT_MASUK");
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("NON_LATIN_SCRIPT");
    expect(res.fallbackText).toBe(FALLBACK_INVALID_REPLY);
  });

  it("rejects text containing Arabic characters", () => {
    const text = "selesai sebelum 17:00, sebelum القائمة jadi objek";
    const res = validateAgentOutput(text, "CHAT_MASUK");
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("NON_LATIN_SCRIPT");
    expect(res.fallbackText).toBe(FALLBACK_INVALID_REPLY);
  });

  it("allows non-Latin text if the owner themselves wrote it in the user message", () => {
    const userMsg = "Tolong kirim ke Mr. สมชาย (Somchai)";
    const replyText = "Baik, pesanan untuk Mr. สมชาย (Somchai) sudah dicatat.";
    const res = validateAgentOutput(replyText, "CHAT_MASUK", userMsg);
    expect(res.valid).toBe(true);
  });

  it("rejects text with 8 or more repeated identical characters (repetition loops)", () => {
    const text = "Catatan penting: '''''''' selesai";
    const res = validateAgentOutput(text, "CHAT_MASUK");
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("REPETITION_LOOP");
    expect(res.fallbackText).toBe(FALLBACK_INVALID_REPLY);
  });

  it("rejects overly long rambling text exceeding CHAT_MASUK length cap", () => {
    const longText = "Kata ".repeat(400); // 2000 chars > 1500
    const res = validateAgentOutput(longText, "CHAT_MASUK");
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("EXCEEDS_LENGTH_CAP");
    expect(res.fallbackText).toBe(FALLBACK_INVALID_REPLY);
  });

  it("allows legitimate long messages for MORNING_BRIEF or other modes", () => {
    const longBrief = "Jadwal dan briefing hari ini:\n" + "Pekerjaan hari ini sangat penting. ".repeat(60); // ~2000 chars
    const res = validateAgentOutput(longBrief, "MORNING_BRIEF");
    expect(res.valid).toBe(true);
  });
});
