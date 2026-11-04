import { describe, expect, it } from "vitest";
import {
  maskChatId,
  parseDaysParam,
  safeBigInt,
  safeDecimal,
  summarizeStats,
  tickHealth,
  truncateMessage,
  usageDateCutoff,
} from "@/lib/analytics/helpers";

describe("parseDaysParam", () => {
  it("mengembalikan default 30 untuk input null atau undefined", () => {
    expect(parseDaysParam(null)).toEqual({ ok: true, days: 30 });
    expect(parseDaysParam(undefined)).toEqual({ ok: true, days: 30 });
  });

  it("menerima bilangan bulat valid dalam rentang 1 sampai 365", () => {
    expect(parseDaysParam("1")).toEqual({ ok: true, days: 1 });
    expect(parseDaysParam("7")).toEqual({ ok: true, days: 7 });
    expect(parseDaysParam("30")).toEqual({ ok: true, days: 30 });
    expect(parseDaysParam("365")).toEqual({ ok: true, days: 365 });
  });

  it("menolak nilai di luar rentang", () => {
    expect(parseDaysParam("0")).toEqual({
      ok: false,
      error: "days harus bilangan bulat antara 1 dan 365",
    });
    expect(parseDaysParam("-5")).toEqual({
      ok: false,
      error: "days harus bilangan bulat antara 1 dan 365",
    });
    expect(parseDaysParam("366")).toEqual({
      ok: false,
      error: "days harus bilangan bulat antara 1 dan 365",
    });
  });

  it("menolak input non-angka atau desimal", () => {
    expect(parseDaysParam("abc")).toEqual({
      ok: false,
      error: "days harus bilangan bulat antara 1 dan 365",
    });
    expect(parseDaysParam("7.5")).toEqual({
      ok: false,
      error: "days harus bilangan bulat antara 1 dan 365",
    });
    expect(parseDaysParam("")).toEqual({
      ok: false,
      error: "days harus bilangan bulat antara 1 dan 365",
    });
    expect(parseDaysParam("  ")).toEqual({
      ok: false,
      error: "days harus bilangan bulat antara 1 dan 365",
    });
  });
});

describe("summarizeStats", () => {
  it("menghitung total target, total selesai, dan rata-rata completion rate", () => {
    const rows = [
      { target_count: 10, done_count: 8, completion_rate: 80 },
      { target_count: 5, done_count: 3, completion_rate: 60 },
    ];
    const summary = summarizeStats(rows);
    expect(summary.total_target).toBe(15);
    expect(summary.total_done).toBe(11);
    expect(summary.average_rate).toBe(70);
  });

  it("mengecualikan baris dengan completion_rate null dari rata-rata", () => {
    const rows = [
      { target_count: 10, done_count: 0, completion_rate: null },
      { target_count: 5, done_count: 3, completion_rate: 60 },
    ];
    const summary = summarizeStats(rows);
    expect(summary.total_target).toBe(15);
    expect(summary.total_done).toBe(3);
    expect(summary.average_rate).toBe(60);
  });

  it("mengembalikan average_rate null jika semua baris memiliki completion_rate null", () => {
    const rows = [
      { target_count: 0, done_count: 0, completion_rate: null },
      { target_count: 0, done_count: 0, completion_rate: null },
    ];
    const summary = summarizeStats(rows);
    expect(summary.total_target).toBe(0);
    expect(summary.total_done).toBe(0);
    expect(summary.average_rate).toBeNull();
  });

  it("mengembalikan null untuk data kosong", () => {
    const summary = summarizeStats([]);
    expect(summary.total_target).toBe(0);
    expect(summary.total_done).toBe(0);
    expect(summary.average_rate).toBeNull();
  });

  it("tidak melakukan pembulatan nilai di lapisan agregasi", () => {
    const rows = [{ target_count: 3, done_count: 1, completion_rate: 33.333333 }];
    const summary = summarizeStats(rows);
    expect(summary.average_rate).toBe(33.333333);
  });
});

describe("tickHealth", () => {
  const base = new Date("2026-10-27T10:00:00.000Z");

  it("mengembalikan NEVER jika lastTickAt bernilai null atau undefined", () => {
    expect(tickHealth(base, null)).toBe("NEVER");
    expect(tickHealth(base, undefined)).toBe("NEVER");
  });

  it("mengembalikan OK jika umur detak tepat dalam ambang stale", () => {
    const withinStale = new Date("2026-10-27T10:03:00.000Z");
    expect(tickHealth(withinStale, base, 3)).toBe("OK");
  });

  it("mengembalikan STALE jika umur detak melebihi ambang stale satu milidetik", () => {
    const pastStale = new Date("2026-10-27T10:03:00.001Z");
    expect(tickHealth(pastStale, base, 3)).toBe("STALE");
  });

  it("mengembalikan OK jika umur detak di bawah ambang stale", () => {
    const oneMinuteLater = new Date("2026-10-27T10:01:00.000Z");
    expect(tickHealth(oneMinuteLater, base, 3)).toBe("OK");
  });

  it("mengembalikan STALE untuk detak yang terlewat jauh dari ambang", () => {
    const tenMinutesLater = new Date("2026-10-27T10:10:00.000Z");
    expect(tickHealth(tenMinutesLater, base, 3)).toBe("STALE");
  });
});

describe("maskChatId", () => {
  it("menyembunyikan karakter selain 4 karakter terakhir", () => {
    expect(maskChatId("6281234567890@c.us")).toBe("**************c.us");
    expect(maskChatId("628123456789")).toBe("********6789");
  });

  it("mempertahankan nilai jika panjangnya kurang atau sama dengan 4", () => {
    expect(maskChatId("1234")).toBe("1234");
    expect(maskChatId("123")).toBe("123");
    expect(maskChatId("")).toBe("");
  });
});

describe("truncateMessage", () => {
  it("mengembalikan string kosong untuk null atau undefined", () => {
    expect(truncateMessage(null)).toBe("");
    expect(truncateMessage(undefined)).toBe("");
  });

  it("tidak memotong teks yang lebih pendek atau sama dengan batas maksimal", () => {
    expect(truncateMessage("halo dunia", 120)).toBe("halo dunia");
    const exact120 = "a".repeat(120);
    expect(truncateMessage(exact120, 120)).toBe(exact120);
  });

  it("memotong teks yang melebihi batas dan menambahkan elipsis", () => {
    const longText = "a".repeat(125);
    const result = truncateMessage(longText, 120);
    expect(result).toBe(`${"a".repeat(120)}...`);
  });

  it("mendukung batas kustom", () => {
    expect(truncateMessage("halo dunia", 4)).toBe("halo...");
  });
});

describe("safeBigInt dan safeDecimal", () => {
  it("mengonversi bigint dan number secara aman", () => {
    expect(safeBigInt(BigInt(123456))).toBe(123456);
    expect(safeBigInt(10)).toBe(10);
    expect(safeBigInt(null)).toBe(0);
    expect(safeBigInt(undefined)).toBe(0);
  });

  it("mengonversi objek Decimal dan angka secara aman", () => {
    expect(safeDecimal(12.34)).toBe(12.34);
    expect(safeDecimal("56.78")).toBe(56.78);
    expect(safeDecimal(null)).toBe(0);
    expect(safeDecimal(undefined)).toBe(0);
    const mockDecimal = {
      toNumber: () => 99.95,
    };
    expect(safeDecimal(mockDecimal)).toBe(99.95);
  });
});

describe("usageDateCutoff zona waktu", () => {
  it("mengelompokkan tanggal lokal secara benar menurut zona waktu user", () => {
    // 2026-10-27T18:00:00Z setara dengan 2026-10-28T01:00:00 WIB (Asia/Jakarta, UTC+7)
    // Untuk days=1 (hari ini saja), tanggal lokal adalah 2026-10-28
    // Titik awal 2026-10-28 00:00:00 WIB adalah 2026-10-27T17:00:00.000Z
    const testNow = new Date("2026-10-27T18:00:00.000Z");
    const cutoff = usageDateCutoff(testNow, "Asia/Jakarta", 1);
    expect(cutoff.toISOString()).toBe("2026-10-27T17:00:00.000Z");
  });

  it("menghitung batas N hari dengan benar", () => {
    // Untuk days=3 dengan anchor 2026-10-28 lokal:
    // 3 hari: 2026-10-28, 2026-10-27, 2026-10-26
    // Batas awal adalah 2026-10-26 00:00:00 WIB = 2026-10-25T17:00:00.000Z
    const testNow = new Date("2026-10-27T18:00:00.000Z");
    const cutoff = usageDateCutoff(testNow, "Asia/Jakarta", 3);
    expect(cutoff.toISOString()).toBe("2026-10-25T17:00:00.000Z");
  });
});
