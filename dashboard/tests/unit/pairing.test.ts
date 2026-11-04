import { describe, expect, it } from "vitest";
import {
  PAIRING_PATTERN,
  generatePairingCode,
  pairingHash,
} from "../../src/lib/pairing";

describe("pairing code generation and hashing", () => {
  it("generates PAIR-XXXXXX format matching PAIRING_PATTERN", () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePairingCode();
      expect(code).toMatch(PAIRING_PATTERN);
      expect(code.startsWith("PAIR-")).toBe(true);
      expect(code.length).toBe(11);
      // Ensures ambiguous characters are excluded from suffix
      expect(code.slice(5)).not.toMatch(/[IO01]/);
    }
  });

  it("normalizes uppercase and trims whitespace in hash calculation", () => {
    const raw = "PAIR-ABC234";
    const lower = "  pair-abc234  ";
    expect(pairingHash(lower)).toBe(pairingHash(raw));
  });
});
