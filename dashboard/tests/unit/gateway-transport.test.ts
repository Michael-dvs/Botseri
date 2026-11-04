import { describe, expect, it } from "vitest";

describe("Gateway Transport (Streaming & Multi-byte UTF-8 Safety)", () => {
  it("decodes multi-byte UTF-8 split across chunk boundaries identically without corruption", async () => {
    // Multi-byte string containing Thai, Chinese, Arabic, and 4-byte Emoji
    const testString = "Bunga Mawar 🌹 — ภาษาไทย ภ — 中文测试 — العربية";
    const fullBytes = new TextEncoder().encode(testString);

    // Simulate arbitrary byte chunk splits right in the middle of multi-byte UTF-8 sequences
    const chunks: Uint8Array[] = [];
    const chunkSize = 3; // Intentionally odd size to guarantee splitting across code points
    for (let i = 0; i < fullBytes.length; i += chunkSize) {
      chunks.push(fullBytes.subarray(i, i + chunkSize));
    }

    // Streaming-safe decoder with stream: true
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let decodedResult = "";
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      decodedResult += decoder.decode(chunks[i], { stream: !isLast });
    }

    // Non-streaming decode
    const nonStreamResult = new TextDecoder("utf-8").decode(fullBytes);

    expect(decodedResult).toBe(testString);
    expect(decodedResult).toBe(nonStreamResult);
    expect(decodedResult).not.toContain("\uFFFD"); // No replacement characters
  });
});
