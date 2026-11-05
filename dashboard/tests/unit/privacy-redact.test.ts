import { describe, expect, it } from "vitest";
import {
  maskChatId,
  maskPhone,
  redactForLlm,
} from "@/lib/security/redact";

describe("S12: Utilitas Redaksi PII & Masking Log", () => {
  describe("1. redactForLlm (Anonymization untuk Payload LLM)", () => {
    it("menyamarkan nomor telepon lokal 08xx dan email menjadi token penanda", () => {
      const input = "Halo saya Budi nomor 081234567890 kirim ke budi@example.com";
      const redacted = redactForLlm(input);
      expect(redacted).toBe("Halo saya Budi nomor [NOMOR_TELEPON] kirim ke [EMAIL]");
    });

    it("menyamarkan format internasional +62xx dan 62xx", () => {
      const input = "Kontak alternatif: +6281987654321 atau 6285551234567 ya";
      const redacted = redactForLlm(input);
      expect(redacted).toBe("Kontak alternatif: [NOMOR_TELEPON] atau [NOMOR_TELEPON] ya");
    });

    it("mempertahankan teks biasa yang bukan informasi pribadi", () => {
      const input = "Buket Bunga Mawar Merah 10 tangkai untuk acara wisuda besok jam 10 pagi";
      const redacted = redactForLlm(input);
      expect(redacted).toBe(input);
    });
  });

  describe("2. maskPhone & maskChatId (Audit Log Masking)", () => {
    it("maskPhone menyamarkan digit tengah nomor telepon", () => {
      expect(maskPhone("081234567890")).toBe("0812****7890");
      expect(maskPhone("+6281234567890")).toBe("+62812****7890");
      expect(maskPhone("08123")).toBe("08123"); // Pendek tidak diubah
    });

    it("maskChatId menyamarkan ID chat WhatsApp dengan benar", () => {
      expect(maskChatId("6281234567890@c.us")).toBe("62812****7890@c.us");
      expect(maskChatId("120363025000000000@g.us")).toBe("120363025000000000@g.us"); // Grup tetap utuh
    });
  });
});
