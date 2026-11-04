"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  brand_name: string;
  business_type: string;
  owner_name: string;
  timezone: string;
  work_hours_start: string;
  work_hours_end: string;
  early_brief_time: string;
  working_days: number[];
  behavior_mode: "STRICT" | "SANTAI";
  behavior_instruction: string | null;
  reminder_interval_minutes: number;
  reminder_max_per_day: number;
  reminder_max_rank: number;
  brief_window_minutes: number;
  eod_window_minutes: number;
  default_due_time: string;
  google_sync_mode: "AUTO" | "BOTH";
  enable_orders: boolean;
  bot_enabled: boolean;
};

type Holiday = { date: string; label: string };
type Feedback = { tone: "ok" | "error"; text: string };

const DAYS = [
  { value: 1, label: "Senin", short: "Sen" },
  { value: 2, label: "Selasa", short: "Sel" },
  { value: 3, label: "Rabu", short: "Rab" },
  { value: 4, label: "Kamis", short: "Kam" },
  { value: 5, label: "Jumat", short: "Jum" },
  { value: 6, label: "Sabtu", short: "Sab" },
  { value: 7, label: "Minggu", short: "Min" },
];

function formatHolidayDate(date: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function errorText(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export function SettingsForm({
  initial,
  initialHolidays,
  promptVersion,
}: {
  initial: Settings;
  initialHolidays: Holiday[];
  promptVersion: number;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saving, setSaving] = useState(false);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayLabel, setHolidayLabel] = useState("");
  const [holidayBusy, setHolidayBusy] = useState<"add" | string | null>(null);
  const [version, setVersion] = useState(promptVersion);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleDay(day: number) {
    if (form.working_days.includes(day)) {
      if (form.working_days.length === 1) {
        setFeedback({ tone: "error", text: "Minimal satu hari kerja harus dipilih." });
        return;
      }
      set("working_days", form.working_days.filter((item) => item !== day));
      return;
    }
    set("working_days", [...form.working_days, day].sort((a, b) => a - b));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (form.working_days.length === 0) {
      setFeedback({ tone: "error", text: "Minimal satu hari kerja harus dipilih." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          behavior_instruction: form.behavior_instruction?.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFeedback({
          tone: "error",
          text: errorText(payload, "Gagal menyimpan pengaturan. Periksa kembali isian."),
        });
        return;
      }
      setVersion((current) => current + 1);
      setFeedback({
        tone: "ok",
        text: "Pengaturan tersimpan dan prompt sistem dikompilasi ulang.",
      });
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: "Tidak dapat menghubungi server." });
    } finally {
      setSaving(false);
    }
  }

  async function addHoliday() {
    if (!holidayDate) {
      setFeedback({ tone: "error", text: "Pilih tanggal hari libur terlebih dahulu." });
      return;
    }
    if (!holidayLabel.trim()) {
      setFeedback({ tone: "error", text: "Keterangan hari libur wajib diisi." });
      return;
    }
    setHolidayBusy("add");
    setFeedback(null);
    try {
      const response = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: holidayDate, label: holidayLabel.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFeedback({
          tone: "error",
          text: errorText(payload, "Gagal menambah hari libur."),
        });
        return;
      }
      const saved: Holiday = payload?.holiday ?? {
        date: holidayDate,
        label: holidayLabel.trim(),
      };
      setHolidays((current) =>
        [...current.filter((holiday) => holiday.date !== saved.date), saved].sort(
          (a, b) => a.date.localeCompare(b.date),
        ),
      );
      setHolidayDate("");
      setHolidayLabel("");
      setFeedback({ tone: "ok", text: "Hari libur disimpan." });
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: "Tidak dapat menghubungi server." });
    } finally {
      setHolidayBusy(null);
    }
  }

  async function removeHoliday(date: string) {
    setHolidayBusy(date);
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/holidays?date=${encodeURIComponent(date)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFeedback({
          tone: "error",
          text: errorText(payload, "Gagal menghapus hari libur."),
        });
        return;
      }
      setHolidays((current) => current.filter((holiday) => holiday.date !== date));
      setFeedback({ tone: "ok", text: "Hari libur dihapus." });
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: "Tidak dapat menghubungi server." });
    } finally {
      setHolidayBusy(null);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Operasional</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Pengaturan</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Nilai di sini dipakai agen untuk jam kerja, pengingat, dan sinkronisasi
            kalender. Menyimpan perubahan juga mengompilasi ulang prompt sistem.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`badge ${form.bot_enabled ? "badge-success" : "badge-warning"}`}>
            {form.bot_enabled ? "Bot aktif" : "Bot dijeda"}
          </span>
          <span className="badge">Prompt v{version}</span>
        </div>
      </header>

      <div aria-live="polite" className="flex flex-col gap-2">
        {feedback ? (
          <p
            role={feedback.tone === "error" ? "alert" : "status"}
            className={`rounded border px-3 py-2 text-sm ${
              feedback.tone === "error"
                ? "border-[#e7c3be] bg-[var(--danger-soft)] text-[var(--danger)]"
                : "border-[#c7d5ad] bg-[var(--success-soft)] text-[var(--success)]"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>

      <section className="panel p-5 sm:p-6" aria-labelledby="profil-usaha">
        <h2 id="profil-usaha" className="text-lg font-semibold">
          Profil usaha
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Dipakai sebagai konteks percakapan dan nama pengirim di WhatsApp.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="field-label">
            Nama brand
            <input
              className="field"
              value={form.brand_name}
              maxLength={100}
              required
              onChange={(event) => set("brand_name", event.target.value)}
            />
          </label>
          <label className="field-label">
            Jenis usaha
            <input
              className="field"
              value={form.business_type}
              maxLength={100}
              required
              onChange={(event) => set("business_type", event.target.value)}
            />
          </label>
          <label className="field-label">
            Nama owner
            <input
              className="field"
              value={form.owner_name}
              maxLength={100}
              required
              onChange={(event) => set("owner_name", event.target.value)}
            />
          </label>
          <label className="field-label">
            Zona waktu
            <input
              className="field font-mono"
              value={form.timezone}
              maxLength={50}
              required
              onChange={(event) => set("timezone", event.target.value)}
            />
            <span className="text-xs font-normal normal-case tracking-normal text-[var(--muted)]">
              Format IANA, contoh Asia/Jakarta.
            </span>
          </label>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded border border-[var(--line)] px-3 py-2 md:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={form.enable_orders}
              onChange={(event) => set("enable_orders", event.target.checked)}
            />
            <span className="text-sm">
              <span className="block font-medium">Aktifkan Modul Pesanan Pelanggan (Orders)</span>
              <span className="block text-xs text-[var(--muted)]">
                Tampilkan menu Pesanan di navigasi dan aktifkan pencatatan order klien via WhatsApp. Matikan opsi ini jika Botseri hanya digunakan untuk manajemen To-Do pribadi.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="panel p-5 sm:p-6" aria-labelledby="jam-kerja">
        <h2 id="jam-kerja" className="text-lg font-semibold">
          Jam kerja dan brief
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Agen hanya mengirim pengingat di dalam jam kerja dan jendela waktu ini.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field-label">
            Jam kerja mulai
            <input
              className="field"
              type="time"
              required
              value={form.work_hours_start}
              onChange={(event) => set("work_hours_start", event.target.value)}
            />
          </label>
          <label className="field-label">
            Jam kerja selesai
            <input
              className="field"
              type="time"
              required
              value={form.work_hours_end}
              onChange={(event) => set("work_hours_end", event.target.value)}
            />
          </label>
          <label className="field-label">
            Morning brief
            <input
              className="field"
              type="time"
              required
              value={form.early_brief_time}
              onChange={(event) => set("early_brief_time", event.target.value)}
            />
          </label>
          <label className="field-label">
            Tenggat default
            <input
              className="field"
              type="time"
              required
              value={form.default_due_time}
              onChange={(event) => set("default_due_time", event.target.value)}
            />
            <span className="text-xs font-normal normal-case tracking-normal text-[var(--muted)]">
              Dipakai saat tugas tidak menyebut jam.
            </span>
          </label>
          <label className="field-label">
            Jendela brief (menit)
            <input
              className="field"
              type="number"
              min={5}
              max={720}
              required
              value={form.brief_window_minutes}
              onChange={(event) =>
                set("brief_window_minutes", Number(event.target.value))
              }
            />
          </label>
          <label className="field-label">
            Jendela evaluasi akhir hari (menit)
            <input
              className="field"
              type="number"
              min={5}
              max={720}
              required
              value={form.eod_window_minutes}
              onChange={(event) =>
                set("eod_window_minutes", Number(event.target.value))
              }
            />
          </label>
        </div>
      </section>

      <section className="panel p-5 sm:p-6" aria-labelledby="hari-kerja">
        <h2 id="hari-kerja" className="text-lg font-semibold">
          Hari kerja
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Hari di luar pilihan ini tidak dihitung sebagai hari operasional.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {DAYS.map((day) => (
            <label
              key={day.value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]"
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={form.working_days.includes(day.value)}
                onChange={() => toggleDay(day.value)}
              />
              <span className="hidden sm:inline">{day.label}</span>
              <span className="sm:hidden">{day.short}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel p-5 sm:p-6" aria-labelledby="hari-libur">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="hari-libur" className="text-lg font-semibold">
              Hari libur
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Tanggal ini dilewati agen saat menyusun jadwal dan pengingat.
            </p>
          </div>
          <span className="badge">{holidays.length} tanggal</span>
        </div>

        {holidays.length === 0 ? (
          <p className="mt-4 rounded border border-dashed border-[var(--line)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            Belum ada hari libur. Tambahkan tanggal di bawah bila perlu.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {holidays.map((holiday) => (
              <li
                key={holiday.date}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{holiday.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {formatHolidayDate(holiday.date)} · {holiday.date}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={holidayBusy === holiday.date}
                  aria-busy={holidayBusy === holiday.date}
                  onClick={() => removeHoliday(holiday.date)}
                >
                  {holidayBusy === holiday.date ? "Menghapus..." : "Hapus"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
          <label className="field-label">
            Tanggal
            <input
              className="field"
              type="date"
              value={holidayDate}
              onChange={(event) => setHolidayDate(event.target.value)}
            />
          </label>
          <label className="field-label">
            Keterangan
            <input
              className="field"
              value={holidayLabel}
              maxLength={100}
              placeholder="Contoh: Libur nasional"
              onChange={(event) => setHolidayLabel(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={holidayBusy === "add"}
            aria-busy={holidayBusy === "add"}
            onClick={addHoliday}
          >
            {holidayBusy === "add" ? "Menyimpan..." : "Tambah hari libur"}
          </button>
        </div>
      </section>

      <section className="panel p-5 sm:p-6" aria-labelledby="pengingat">
        <h2 id="pengingat" className="text-lg font-semibold">
          Pengingat
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Batasi frekuensi agar agen tidak mengirim pesan berulang.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="field-label">
            Interval (menit)
            <input
              className="field"
              type="number"
              min={0}
              max={1440}
              required
              value={form.reminder_interval_minutes}
              onChange={(event) =>
                set("reminder_interval_minutes", Number(event.target.value))
              }
            />
            <span className="text-xs font-normal normal-case tracking-normal text-[var(--muted)]">
              0 berarti tanpa interval tetap.
            </span>
          </label>
          <label className="field-label">
            Maksimum per hari
            <input
              className="field"
              type="number"
              min={0}
              max={24}
              required
              value={form.reminder_max_per_day}
              onChange={(event) =>
                set("reminder_max_per_day", Number(event.target.value))
              }
            />
          </label>
          <label className="field-label">
            Reminder sampai rank
            <input
              className="field"
              type="number"
              min={1}
              max={99}
              required
              value={form.reminder_max_rank}
              onChange={(event) =>
                set("reminder_max_rank", Number(event.target.value))
              }
            />
            <span className="text-xs font-normal normal-case tracking-normal text-[var(--muted)]">
              Hanya tugas dengan rank ini atau lebih penting.
            </span>
          </label>
        </div>
      </section>

      <section className="panel p-5 sm:p-6" aria-labelledby="perilaku">
        <h2 id="perilaku" className="text-lg font-semibold">
          Perilaku dan sinkronisasi
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="field-label">
            Mode perilaku
            <select
              className="field"
              value={form.behavior_mode}
              onChange={(event) =>
                set("behavior_mode", event.target.value as Settings["behavior_mode"])
              }
            >
              <option value="STRICT">STRICT: tegas dan langsung</option>
              <option value="SANTAI">SANTAI: lebih longgar</option>
            </select>
          </label>
          <label className="field-label">
            Mode sinkronisasi Google
            <select
              className="field"
              value={form.google_sync_mode}
              onChange={(event) =>
                set(
                  "google_sync_mode",
                  event.target.value as Settings["google_sync_mode"],
                )
              }
            >
              <option value="AUTO">AUTO: Calendar untuk jam spesifik, sisanya Tasks</option>
              <option value="BOTH">BOTH: kirim ke Calendar dan Tasks</option>
            </select>
          </label>
          <label className="field-label md:col-span-2">
            Instruksi perilaku tambahan
            <textarea
              className="field min-h-24 resize-y"
              rows={3}
              maxLength={4000}
              placeholder="Contoh: Selalu sebut nama pelanggan dan hindari pesan panjang."
              value={form.behavior_instruction ?? ""}
              onChange={(event) => set("behavior_instruction", event.target.value)}
            />
            <span className="text-xs font-normal normal-case tracking-normal text-[var(--muted)]">
              Kosongkan bila tidak ada tambahan.
            </span>
          </label>
        </div>

        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 rounded border border-[var(--line)] px-3 py-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={form.bot_enabled}
            onChange={(event) => set("bot_enabled", event.target.checked)}
          />
          <span className="text-sm">
            <span className="block font-medium">Bot aktif</span>
            <span className="block text-xs text-[var(--muted)]">
              Saat dimatikan, pesan masuk tidak diproses dan pengingat berhenti.
            </span>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? "Menyimpan..." : "Simpan pengaturan"}
        </button>
        <p className="text-xs text-[var(--muted)]">
          Versi prompt akan naik satu setiap penyimpanan berhasil.
        </p>
      </div>
    </form>
  );
}
