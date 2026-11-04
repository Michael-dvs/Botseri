import { describe, expect, it } from "vitest";
import { formatTaskAlarm } from "../../src/lib/scheduler/queries";

describe("Deterministic Alarm Message String Builder", () => {
  const tz = "Asia/Jakarta";

  it("To-do hanya dengan remind_at menghasilkan teks pengingat agenda (tanpa kata Tenggat dan tanpa 1 jam lagi)", () => {
    // 10:35 WIB = 03:35 UTC
    const remindAt = new Date("2026-10-29T03:35:00.000Z");
    const text = formatTaskAlarm({
      title: "Meeting PPPL",
      remindAt,
      now: remindAt,
      timezone: tz,
    });

    expect(text).toBe("🔔 Pengingat: Waktunya *Meeting PPPL* sekarang (10:35 WIB). Semangat!");
    expect(text).not.toContain("Tenggat");
    expect(text).not.toContain("1 jam lagi");
    expect(text).not.toContain("—");
  });

  it("To-do dengan due_at jam 11:35 dan alarm jam 10:35 menghasilkan teks dengan selisih menit dinamis (60 menit lagi)", () => {
    // due_at = 11:35 WIB (04:35 UTC), remind_at = 10:35 WIB (03:35 UTC), now = 10:35 WIB
    const dueAt = new Date("2026-10-29T04:35:00.000Z");
    const remindAt = new Date("2026-10-29T03:35:00.000Z");
    const now = new Date("2026-10-29T03:35:00.000Z");

    const text = formatTaskAlarm({
      title: "Tugas PPPL",
      dueAt,
      remindAt,
      now,
      timezone: tz,
    });

    expect(text).toBe(
      "🔔 Pengingat: Tugas *Tugas PPPL* mendekati batas waktu (Tenggat: 11:35 WIB · 60 menit lagi). Semangat tuntaskan ya!",
    );
    expect(text).toContain("60 menit lagi");
    expect(text).not.toContain("1 jam lagi");
    expect(text).not.toContain("—");
  });

  it("To-do dengan due_at jam 11:00 dan alarm jam 10:45 menghasilkan teks '15 menit lagi'", () => {
    const dueAt = new Date("2026-10-29T04:00:00.000Z"); // 11:00 WIB
    const remindAt = new Date("2026-10-29T03:45:00.000Z"); // 10:45 WIB
    const now = new Date("2026-10-29T03:45:00.000Z");

    const text = formatTaskAlarm({
      title: "Submit Proposal",
      dueAt,
      remindAt,
      now,
      timezone: tz,
    });

    expect(text).toBe(
      "🔔 Pengingat: Tugas *Submit Proposal* mendekati batas waktu (Tenggat: 11:00 WIB · 15 menit lagi). Semangat tuntaskan ya!",
    );
    expect(text).toContain("15 menit lagi");
    expect(text).not.toContain("—");
  });

  it("To-do hanya dengan due_at tanpa remind_at menghasilkan teks batas waktu tiba sekarang", () => {
    const dueAt = new Date("2026-10-29T04:35:00.000Z"); // 11:35 WIB
    const text = formatTaskAlarm({
      title: "Tugas RPL2",
      dueAt,
      timezone: tz,
    });

    expect(text).toBe("🔔 Pengingat: Batas waktu tugas *Tugas RPL2* tiba sekarang (11:35 WIB).");
    expect(text).not.toContain("—");
  });

  it("Menetralkan format markdown WhatsApp dari judul pengguna", () => {
    const remindAt = new Date("2026-10-29T03:35:00.000Z");
    const text = formatTaskAlarm({
      title: "*Meeting* _PPPL_ `v2`",
      remindAt,
      now: remindAt,
      timezone: tz,
    });

    expect(text).toBe("🔔 Pengingat: Waktunya *Meeting PPPL v2* sekarang (10:35 WIB). Semangat!");
    expect(text).not.toContain("—");
  });
});
