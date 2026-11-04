import { isLidSender, getLidIdentifier } from "../../src/lib/phone";
import { describe, expect, it } from "vitest";
import { normalizeToE164, resolveSenderE164 } from "../../src/lib/phone";

describe("normalizeToE164", () => {
  it("normalizes standard WhatsApp JID (@c.us)", () => {
    expect(normalizeToE164("628123456789@c.us")).toBe("+628123456789");
  });

  it("normalizes JID with leading plus (+628123456789@c.us)", () => {
    expect(normalizeToE164("+628123456789@c.us")).toBe("+628123456789");
  });

  it("normalizes @s.whatsapp.net domain", () => {
    expect(normalizeToE164("628123456789@s.whatsapp.net")).toBe("+628123456789");
  });

  it("strips device suffix (:12) before @s.whatsapp.net", () => {
    expect(normalizeToE164("628123456789:12@s.whatsapp.net")).toBe("+628123456789");
    expect(normalizeToE164("628123456789:0@c.us")).toBe("+628123456789");
  });

  it("normalizes formatted phone input with spaces, dashes, parentheses", () => {
    expect(normalizeToE164("+62 812-3456-7890")).toBe("+6281234567890");
    expect(normalizeToE164("62 (812) 3456-7890")).toBe("+6281234567890");
  });

  it("returns null for empty, whitespace, null, and undefined input", () => {
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("   ")).toBeNull();
    expect(normalizeToE164(null)).toBeNull();
    expect(normalizeToE164(undefined)).toBeNull();
  });

  it("returns null for @lid opaque identifier", () => {
    expect(normalizeToE164("123456789012345@lid")).toBeNull();
    expect(normalizeToE164("user@lid")).toBeNull();
  });

  it("returns null for group JID (@g.us)", () => {
    expect(normalizeToE164("628123456789-123456@g.us")).toBeNull();
    expect(normalizeToE164("120363025244@g.us")).toBeNull();
  });

  it("returns null for broadcasts and newsletters", () => {
    expect(normalizeToE164("status@broadcast")).toBeNull();
    expect(normalizeToE164("1203630@newsletter")).toBeNull();
  });

  it("returns null for numbers that are too short (< 7 digits)", () => {
    expect(normalizeToE164("12345")).toBeNull();
    expect(normalizeToE164("+123456")).toBeNull();
  });

  it("returns null for numbers that are too long (> 15 digits)", () => {
    expect(normalizeToE164("1234567890123456")).toBeNull();
    expect(normalizeToE164("+12345678901234567")).toBeNull();
  });

  it("returns null when letters are mixed in", () => {
    expect(normalizeToE164("62812abc345")).toBeNull();
    expect(normalizeToE164("user123@c.us")).toBeNull();
    expect(normalizeToE164("+62812FOOBAR")).toBeNull();
  });

  it("returns null when country code is missing (starts with 0)", () => {
    expect(normalizeToE164("08123456789")).toBeNull();
    expect(normalizeToE164("+08123456789")).toBeNull();
  });

  it("accepts valid boundary lengths (7 digits and 15 digits)", () => {
    expect(normalizeToE164("+1234567")).toBe("+1234567");
    expect(normalizeToE164("123456789012345")).toBe("+123456789012345");
  });
});

describe("resolveSenderE164", () => {
  it("prioritizes participant for group events", () => {
    const sender = resolveSenderE164({
      participant: "628111111111@c.us",
      from: "120363025244@g.us",
      chat_id: "120363025244@g.us",
    });
    expect(sender).toBe("+628111111111");
  });

  it("falls back through priority order when earlier candidate is missing or invalid", () => {
    const sender = resolveSenderE164({
      participant: null,
      from: "invalid@lid",
      chat_id: "628222222222@c.us",
    });
    expect(sender).toBe("+628222222222");
  });

  it("returns null if all candidates are invalid or @lid", () => {
    const sender = resolveSenderE164({
      from: "invalid@lid",
      chat_id: "status@broadcast",
    });
    expect(sender).toBeNull();
  });
  it("resolves real observed WAHA NOWEB LID payload using remote_jid_alt", () => {
    const sender = resolveSenderE164({
      from: "160275344937145@lid",
      chat_id: "160275344937145@lid",
      remote_jid_alt: "6287881820571@s.whatsapp.net",
    });
    expect(sender).toBe("+6287881820571");
  });

  it("resolves nested _data.key.remoteJidAlt from raw WAHA payload", () => {
    const sender = resolveSenderE164({
      from: "160275344937145@lid",
      chat_id: "160275344937145@lid",
      _data: {
        key: {
          remoteJid: "160275344937145@lid",
          remoteJidAlt: "6287881820571@s.whatsapp.net",
          fromMe: false,
          id: "3B754E6DE938F57735EB",
          participant: "",
          addressingMode: "lid",
        },
      },
    });
    expect(sender).toBe("+6287881820571");
  });

  it("detects LID sender using isLidSender", () => {
    expect(isLidSender({ from: "160275344937145@lid" })).toBe(true);
    expect(isLidSender({ from: "628123456789@c.us" })).toBe(false);
    expect(getLidIdentifier({ from: "160275344937145@lid" })).toBe("160275344937145@lid");
  });
});
