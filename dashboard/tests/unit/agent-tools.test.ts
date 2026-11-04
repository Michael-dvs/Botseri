import { describe, expect, it } from "vitest";
import type { BotSettings, PriorityLevel } from "@prisma/client";
import {
  buildDedupeKey,
  fuzzyMatch,
  normalizeText,
} from "../../src/lib/todos";
import { resolveDueAt, resolvePriority } from "../../src/lib/todos/create";

describe("Agent Tools & Todos Logic (Step 06)", () => {
  describe("1. normalizeText & buildDedupeKey", () => {
    it("normalizes accents, punctuation, and extra whitespace", () => {
      const input = "  Antar   Buket Bunga (Mawar & Melati)!  ";
      expect(normalizeText(input)).toBe("antar buket bunga mawar melati");
    });

    it("generates deterministic SHA-1 dedupe_key based on sourceMessageId, title, and dueAt", () => {
      const msgId = "11111111-2222-3333-4444-555555555555";
      const title = "Antar buket Bu Ani";
      const dueAt = new Date("2026-10-21T10:00:00Z");

      const key1 = buildDedupeKey(msgId, title, dueAt);
      const key2 = buildDedupeKey(msgId, "  antar buket bu ani  ", dueAt);
      const keyDiffMsg = buildDedupeKey("99999999-2222-3333-4444-555555555555", title, dueAt);

      expect(key1).not.toBeNull();
      expect(key1).toBe(key2);
      expect(key1).not.toBe(keyDiffMsg);
    });

    it("returns null if sourceMessageId is null", () => {
      expect(buildDedupeKey(null, "Judul", new Date())).toBeNull();
    });
  });

  describe("2. fuzzyMatch", () => {
    const candidates = [
      { id: "1", title: "Beli bunga mawar merah di pasar" },
      { id: "2", title: "Beli vas kaca silinder" },
      { id: "3", title: "Antar pesanan Bu Ani" },
      { id: "4", title: "Beli bunga mawar putih" },
    ];

    it("matches exact substring with highest score", () => {
      const result = fuzzyMatch("bunga mawar merah", candidates);
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].id).toBe("1");
      expect(result.ambiguous).toBe(false);
    });

    it("detects ambiguity when multiple candidates have the same score", () => {
      const result = fuzzyMatch("bunga", candidates);
      // "Beli bunga mawar merah" and "Beli bunga mawar putih" both contain "bunga"
      expect(result.ambiguous).toBe(true);
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty matches when query does not match any candidate", () => {
      const result = fuzzyMatch("mobil sedan", candidates);
      expect(result.matches).toHaveLength(0);
      expect(result.ambiguous).toBe(false);
    });
  });

  describe("3. resolvePriority", () => {
    const levels: PriorityLevel[] = [
      {
        id: "l1",
        rank: 1,
        label: "Kritis",
        description: null,
        rule_text: "Urgent",
        color: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: "l2",
        rank: 2,
        label: "Rutin",
        description: null,
        rule_text: "Routine",
        color: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    it("resolves exact rank when exists", () => {
      const { level, warning } = resolvePriority(1, levels);
      expect(level.id).toBe("l1");
      expect(warning).toBeNull();
    });

    it("falls back to lowest priority rank with warning when rank does not exist", () => {
      const { level, warning } = resolvePriority(99, levels);
      expect(level.id).toBe("l2"); // rank 2 is lowest
      expect(warning).toContain("tidak valid; dipakai rank 2");
    });
  });

  describe("4. resolveDueAt", () => {
    const settings = {
      timezone: "Asia/Jakarta",
      default_due_time: "17:00",
    } as BotSettings;

    it("resolves today date when due_at is omitted", () => {
      const result = resolveDueAt({ title: "Tugas", priority_rank: 1, has_specific_time: false }, settings);
      expect(result.dueAt).toBeNull();
      expect(result.hasSpecificTime).toBe(false);
      expect(result.plannedDate.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    });

    it("resolves specific time when has_specific_time is true", () => {
      const input = {
        title: "Tugas jam 14",
        priority_rank: 1,
        due_at: "2026-10-21T14:00:00+07:00",
        has_specific_time: true,
      };
      const result = resolveDueAt(input, settings);
      expect(result.dueAt).toEqual(new Date("2026-10-21T07:00:00.000Z"));
      expect(result.plannedDate.toISOString()).toBe("2026-10-21T00:00:00.000Z");
      expect(result.hasSpecificTime).toBe(true);
    });

    it("falls back to default_due_time when has_specific_time is false", () => {
      const input = {
        title: "Tugas tanggal saja",
        priority_rank: 1,
        due_at: "2026-10-21T00:00:00+07:00",
        has_specific_time: false,
      };
      const result = resolveDueAt(input, settings);
      // 17:00 Jakarta (UTC+7) -> 10:00 UTC
      expect(result.dueAt?.toISOString()).toBe("2026-10-21T10:00:00.000Z");
      expect(result.plannedDate.toISOString()).toBe("2026-10-21T00:00:00.000Z");
      expect(result.hasSpecificTime).toBe(false);
    });
  });
});
