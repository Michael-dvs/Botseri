"use client";

import { useState } from "react";
import { formatLocalDateTime } from "@/lib/time";

export type AuthorizedNumberItem = {
  id: string;
  phone_e164: string;
  chat_id: string;
  label: string | null;
  is_owner: boolean;
  is_primary: boolean;
  created_at: string | Date;
  updated_at?: string | Date;
};

interface AuthorizedNumbersListProps {
  initialNumbers: AuthorizedNumberItem[];
  timezone?: string;
  onRefreshNeeded?: () => void;
}

export function AuthorizedNumbersList({
  initialNumbers,
  timezone = "Asia/Jakarta",
  onRefreshNeeded,
}: AuthorizedNumbersListProps) {
  const [numbers, setNumbers] = useState<AuthorizedNumberItem[]>(initialNumbers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function refreshList() {
    try {
      const res = await fetch("/api/authorized-numbers");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.numbers)) {
          setNumbers(data.numbers);
        }
      }
    } catch {
      // Abaikan error fetch background
    }
    if (onRefreshNeeded) onRefreshNeeded();
  }

  async function setPrimary(id: string) {
    setBusyId(`primary-${id}`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/authorized-numbers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_primary: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ tone: "error", text: data.error || "Gagal mengubah nomor utama." });
        return;
      }
      setFeedback({ tone: "ok", text: "Nomor utama pengingat berhasil diperbarui." });
      await refreshList();
    } catch {
      setFeedback({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusyId(null);
    }
  }

  async function saveLabel(id: string) {
    setBusyId(`label-${id}`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/authorized-numbers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editingLabel.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ tone: "error", text: data.error || "Gagal menyimpan label." });
        return;
      }
      setEditingId(null);
      setFeedback({ tone: "ok", text: "Label nomor berhasil disimpan." });
      await refreshList();
    } catch {
      setFeedback({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteNumber(id: string) {
    setBusyId(`delete-${id}`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/authorized-numbers/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ tone: "error", text: data.error || "Gagal mencabut otorisasi nomor." });
        return;
      }
      setConfirmDeleteId(null);
      setFeedback({ tone: "ok", text: "Otorisasi nomor berhasil dicabut." });
      await refreshList();
    } catch {
      setFeedback({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6 border-t border-[var(--line)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="eyebrow">Akses &amp; Notifikasi</p>
          <h3 className="text-sm font-semibold">Daftar Nomor Terhubung &amp; Terotorisasi</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Nomor WhatsApp yang memiliki hak akses perintah to-do dan menerima pengingat harian.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshList}
          className="btn btn-quiet min-h-[44px] text-xs font-mono text-[var(--muted)] hover:text-[var(--ink)]"
        >
          [ Segarkan Daftar ]
        </button>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`mb-4 p-3 rounded text-xs flex items-center justify-between gap-2 ${
            feedback.tone === "ok"
              ? "bg-[var(--success-soft)] text-[var(--success)] border border-[var(--success)]"
              : "bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger)]"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="font-mono text-xs px-2 py-0.5"
          >
            x
          </button>
        </div>
      )}

      {numbers.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">
          <p className="font-medium text-[var(--ink)]">Belum ada nomor WhatsApp terdaftar</p>
          <p className="mt-1">
            Gunakan tombol &quot;Buat kode otorisasi pemilik&quot; di atas untuk menghubungkan nomor pertama Anda.
          </p>
        </div>
      ) : (
        <div>
          {/* Tampilan Tabel Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wider text-[var(--muted)] font-mono">
                  <th className="py-2.5 font-medium">Nomor WhatsApp</th>
                  <th className="py-2.5 font-medium">Status &amp; Peran</th>
                  <th className="py-2.5 font-medium">Label / Keterangan</th>
                  <th className="py-2.5 font-medium">Terdaftar</th>
                  <th className="py-2.5 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {numbers.map((item) => {
                  const isBusy = busyId === `primary-${item.id}` || busyId === `delete-${item.id}`;
                  const isEditing = editingId === item.id;

                  return (
                    <tr key={item.id} className="hover:bg-[var(--surface-muted)] transition-colors">
                      <td className="py-3 font-mono text-xs font-bold text-[var(--ink)]">
                        {item.phone_e164}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.is_primary ? (
                            <span className="badge bg-[var(--accent)] text-[#fff7ed] font-semibold border-transparent">
                              Pemilik Utama
                            </span>
                          ) : item.is_owner ? (
                            <span className="badge border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted)] font-medium">
                              Pemilik Tambahan
                            </span>
                          ) : (
                            <span className="badge">Staf</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-xs">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editingLabel}
                              onChange={(e) => setEditingLabel(e.target.value)}
                              className="field py-1 px-2 text-xs font-mono w-40 min-h-[36px]"
                              placeholder="Nama label..."
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => saveLabel(item.id)}
                              disabled={busyId === `label-${item.id}`}
                              className="btn btn-primary min-h-[36px] px-2.5 text-xs font-mono"
                            >
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="btn btn-quiet min-h-[36px] px-2 text-xs font-mono text-[var(--muted)]"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--ink)] font-medium">
                              {item.label || "Belum ada label"}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(item.id);
                                setEditingLabel(item.label || "");
                              }}
                              className="text-[11px] font-mono text-[var(--accent)] hover:underline min-h-[44px] inline-flex items-center"
                            >
                              [Ubah]
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-3 font-mono text-xs text-[var(--muted)] whitespace-nowrap">
                        {formatLocalDateTime(item.created_at, timezone)}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!item.is_primary && item.is_owner && (
                            <button
                              type="button"
                              onClick={() => setPrimary(item.id)}
                              disabled={isBusy}
                              className="btn btn-secondary min-h-[44px] px-3 text-xs font-mono font-medium"
                            >
                              Jadikan Utama
                            </button>
                          )}

                          {confirmDeleteId === item.id ? (
                            <div className="flex items-center gap-1.5 bg-[var(--danger-soft)] p-1 rounded border border-[var(--danger)]">
                              <span className="text-[11px] text-[var(--danger)] font-medium px-1">Yakin?</span>
                              <button
                                type="button"
                                onClick={() => deleteNumber(item.id)}
                                disabled={isBusy}
                                className="btn border border-[var(--danger)] bg-[var(--danger)] text-white text-xs min-h-[36px] px-2 font-mono"
                              >
                                Ya, Cabut
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="btn btn-quiet min-h-[36px] px-2 text-xs font-mono text-[var(--muted)]"
                              >
                                Batal
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              disabled={isBusy}
                              className="btn btn-quiet min-h-[44px] px-2 text-xs font-mono text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                            >
                              Cabut Izin
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Tampilan Kartu Mobile (R-03: Responsive tanpa horizontal overflow) */}
          <div className="md:hidden space-y-3">
            {numbers.map((item) => {
              const isBusy = busyId === `primary-${item.id}` || busyId === `delete-${item.id}`;
              const isEditing = editingId === item.id;

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3.5 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                    <span className="font-mono font-bold text-sm text-[var(--ink)]">
                      {item.phone_e164}
                    </span>
                    {item.is_primary ? (
                      <span className="badge bg-[var(--accent)] text-[#fff7ed] font-semibold border-transparent">
                        Pemilik Utama
                      </span>
                    ) : item.is_owner ? (
                      <span className="badge border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted)] font-medium">
                        Pemilik Tambahan
                      </span>
                    ) : (
                      <span className="badge">Staf</span>
                    )}
                  </div>

                  <div className="mt-2.5 space-y-2 text-xs">
                    <div>
                      <span className="text-[var(--muted)] block">Label:</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <input
                            type="text"
                            value={editingLabel}
                            onChange={(e) => setEditingLabel(e.target.value)}
                            className="field py-1 px-2 text-xs font-mono flex-1 min-h-[44px]"
                            placeholder="Nama label..."
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => saveLabel(item.id)}
                            disabled={busyId === `label-${item.id}`}
                            className="btn btn-primary min-h-[44px] px-3 font-mono text-xs"
                          >
                            Simpan
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="btn btn-quiet min-h-[44px] px-2 font-mono text-xs"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="font-medium text-[var(--ink)]">
                            {item.label || "Belum ada label"}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(item.id);
                              setEditingLabel(item.label || "");
                            }}
                            className="font-mono text-xs text-[var(--accent)] hover:underline min-h-[44px] flex items-center"
                          >
                            [Ubah Label]
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[var(--muted)] font-mono text-[11px] pt-1 border-t border-[var(--line)]">
                      <span>Terdaftar:</span>
                      <span>{formatLocalDateTime(item.created_at, timezone)}</span>
                    </div>

                    {/* Tombol Aksi Mobile */}
                    <div className="pt-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)]">
                      {!item.is_primary && item.is_owner && (
                        <button
                          type="button"
                          onClick={() => setPrimary(item.id)}
                          disabled={isBusy}
                          className="btn btn-secondary min-h-[44px] px-3 text-xs font-mono font-medium flex-1"
                        >
                          Jadikan Utama
                        </button>
                      )}

                      {confirmDeleteId === item.id ? (
                        <div className="flex items-center justify-between gap-2 bg-[var(--danger-soft)] p-2 rounded border border-[var(--danger)] w-full">
                          <span className="text-xs text-[var(--danger)] font-medium">Yakin cabut izin nomor ini?</span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => deleteNumber(item.id)}
                              disabled={isBusy}
                              className="btn border border-[var(--danger)] bg-[var(--danger)] text-white text-xs min-h-[44px] px-3 font-mono"
                            >
                              Ya, Cabut
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="btn btn-quiet min-h-[44px] px-2 text-xs font-mono text-[var(--muted)]"
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          disabled={isBusy}
                          className="btn btn-quiet min-h-[44px] px-3 text-xs font-mono text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                        >
                          Cabut Izin
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
