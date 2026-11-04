"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatLocalDateTime,
  localDateTimeInputToUtc,
} from "@/lib/time";

type PaymentStatus = "UNPAID" | "DP_PAID" | "PAID";
type OperationalStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

type OrderRow = {
  id: string;
  customer_name: string;
  customer_contact: string | null;
  description: string;
  event_date: string | null;
  delivery_date: string | null;
  delivery_address: string | null;
  total_amount: number | null;
  dp_amount: number | null;
  payment_status: PaymentStatus;
  status?: OperationalStatus;
  notes: string | null;
  deleted_at?: string | null;
};

const paymentLabels: Record<PaymentStatus, string> = {
  UNPAID: "Belum dibayar",
  DP_PAID: "DP dibayar",
  PAID: "Lunas",
};

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function money(value: number | null) {
  return value === null ? "Belum diisi" : rupiah.format(value);
}

function paymentBadge(status: PaymentStatus) {
  if (status === "PAID") return "badge badge-success";
  if (status === "DP_PAID") return "badge badge-warning";
  return "badge";
}

const operationalLabels: Record<OperationalStatus, string> = {
  PENDING: "Menunggu",
  IN_PROGRESS: "Dikerjakan",
  COMPLETED: "Selesai",
  CANCELLED: "Batal",
};

function operationalBadge(status?: OperationalStatus) {
  if (status === "COMPLETED") return "badge badge-success";
  if (status === "IN_PROGRESS") return "badge badge-accent";
  if (status === "CANCELLED") return "badge badge-danger";
  return "badge";
}

export function OrderBoard({
  initialOrders,
  initialDeletedOrders = [],
  timezone,
}: {
  initialOrders: OrderRow[];
  initialDeletedOrders?: OrderRow[];
  timezone: string;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [deletedOrders, setDeletedOrders] = useState(initialDeletedOrders);
  const [viewTab, setViewTab] = useState<"ACTIVE" | "TRASH">("ACTIVE");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    setDeletedOrders(initialDeletedOrders);
  }, [initialDeletedOrders]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const eventInput = String(form.get("event_date") ?? "");
    const deliveryInput = String(form.get("delivery_date") ?? "");
    const totalInput = String(form.get("total_amount") ?? "").trim();
    const dpInput = String(form.get("dp_amount") ?? "").trim();
    const total = totalInput ? Number(totalInput) : null;
    const dp = dpInput ? Number(dpInput) : null;

    if (
      (total !== null && (!Number.isFinite(total) || total < 0)) ||
      (dp !== null && (!Number.isFinite(dp) || dp < 0))
    ) {
      setError("Nominal tidak valid.");
      return;
    }

    let eventDate: string | null = null;
    let deliveryDate: string | null = null;
    if (eventInput) {
      const converted = localDateTimeInputToUtc(eventInput, timezone);
      if (Number.isNaN(converted.getTime())) {
        setError("Tanggal acara tidak valid.");
        return;
      }
      eventDate = converted.toISOString();
    }
    if (deliveryInput) {
      const converted = localDateTimeInputToUtc(deliveryInput, timezone);
      if (Number.isNaN(converted.getTime())) {
        setError("Tanggal kirim tidak valid.");
        return;
      }
      deliveryDate = converted.toISOString();
    }

    setPending("create");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: String(form.get("customer_name") ?? "").trim(),
          customer_contact:
            String(form.get("customer_contact") ?? "").trim() || null,
          description: String(form.get("description") ?? "").trim(),
          event_date: eventDate,
          delivery_date: deliveryDate,
          delivery_address:
            String(form.get("delivery_address") ?? "").trim() || null,
          total_amount: total,
          dp_amount: dp,
          payment_status: form.get("payment_status"),
          status: form.get("status") || "PENDING",
          notes: String(form.get("notes") ?? "").trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menyimpan pesanan.",
        );
        return;
      }
      setOrders((current) => [
        payload.order as OrderRow,
        ...current,
      ]);
      setMessage("Pesanan ditambahkan.");
      formElement.reset();
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  async function setPayment(id: string, paymentStatus: PaymentStatus) {
    setPending(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_status: paymentStatus }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal mengubah pembayaran.",
        );
        return;
      }
      const updated = payload.order as OrderRow;
      setOrders((current) =>
        current.map((order) => (order.id === id ? updated : order)),
      );
      setMessage(`Pembayaran diubah menjadi ${paymentLabels[paymentStatus]}.`);
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }
  async function setOperationalStatus(id: string, nextStatus: OperationalStatus) {
    setPending(id);
    setError("");
    setMessage("");

    const order = orders.find((entry) => entry.id === id);
    if (!order) return;

    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        throw new Error("Gagal memperbarui status operasional.");
      }

      setOrders((prev) =>
        prev.map((entry) =>
          entry.id === id ? { ...entry, status: nextStatus } : entry,
        ),
      );
      setMessage(`Status pengerjaan diubah menjadi ${operationalLabels[nextStatus]}.`);
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }
  async function handleToggleBlockCustomer(phone: string) {
    const action = window.prompt(
      `Ketik "BLOKIR" untuk memblokir nomor ${phone}, atau "BUKA" untuk membuka blokir:`,
      "BLOKIR"
    );
    if (!action) return;
    const isBlock = action.trim().toUpperCase() === "BLOKIR";
    const endpoint = isBlock ? "/api/customer/block" : "/api/customer/unblock";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: phone }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Gagal memproses blokir.");
      } else {
        setMessage(data.message || "Aksi blokir berhasil.");
        router.refresh();
      }
    } catch {
      setError("Tidak dapat menghubungi server.");
    }
  }



  async function remove(order: OrderRow) {
    if (!window.confirm(`Hapus pesanan dari "${order.customer_name}"?`)) return;
    setPending(order.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menghapus pesanan.",
        );
        return;
      }
      setOrders((current) =>
        current.filter((item) => item.id !== order.id),
      );
      setDeletedOrders((current) => [
        { ...order, deleted_at: new Date().toISOString() },
        ...current,
      ]);
      setMessage("Pesanan berhasil dipindahkan ke sampah.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  async function restore(order: OrderRow) {
    setPending(order.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal memulihkan pesanan.",
        );
        return;
      }
      setDeletedOrders((current) => current.filter((item) => item.id !== order.id));
      setOrders((current) => [{ ...order, deleted_at: null, status: "PENDING" }, ...current]);
      setMessage(`Pesanan ${order.customer_name} berhasil dipulihkan dari sampah.`);
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Buku pesanan</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Pesanan
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {orders.length} pesanan tercatat, diurutkan dari tanggal kirim
            terdekat.
          </p>
        </div>
      </header>

      <form
        onSubmit={create}
        className="panel p-4 sm:p-5"
        aria-label="Tambah pesanan"
      >
        <div className="grid gap-3 md:grid-cols-12">
          <label className="field-label md:col-span-3">
            Nama pelanggan
            <input
              name="customer_name"
              required
              maxLength={150}
              className="field"
              placeholder="Bu Ani"
            />
          </label>
          <label className="field-label md:col-span-3">
            Kontak
            <input
              name="customer_contact"
              maxLength={50}
              className="field"
              placeholder="08xx atau @instagram"
            />
          </label>
          <label className="field-label md:col-span-2">
            Status pengerjaan
            <select name="status" className="field" defaultValue="PENDING">
              <option value="PENDING">Menunggu</option>
              <option value="IN_PROGRESS">Dikerjakan</option>
              <option value="COMPLETED">Selesai</option>
              <option value="CANCELLED">Batal</option>
            </select>
          </label>
          <label className="field-label md:col-span-2">
            Status bayar
            <select name="payment_status" className="field">
              <option value="UNPAID">Belum dibayar</option>
              <option value="DP_PAID">DP dibayar</option>
              <option value="PAID">Lunas</option>
            </select>
          </label>
          <label className="field-label md:col-span-2">
            Total
            <input
              name="total_amount"
              type="number"
              min="0"
              step="0.01"
              className="field"
              placeholder="750000"
            />
          </label>
          <label className="field-label md:col-span-2">
            DP
            <input
              name="dp_amount"
              type="number"
              min="0"
              step="0.01"
              className="field"
              placeholder="300000"
            />
          </label>

          <label className="field-label md:col-span-6">
            Deskripsi pesanan
            <input
              name="description"
              required
              maxLength={4000}
              className="field"
              placeholder="Buket mawar putih, kartu ucapan"
            />
          </label>
          <label className="field-label md:col-span-3">
            Tanggal acara
            <input name="event_date" type="datetime-local" className="field" />
          </label>
          <label className="field-label md:col-span-3">
            Tanggal kirim
            <input
              name="delivery_date"
              type="datetime-local"
              className="field"
            />
          </label>

          <label className="field-label md:col-span-6">
            Alamat kirim
            <input
              name="delivery_address"
              maxLength={2000}
              className="field"
              placeholder="Alamat lengkap"
            />
          </label>
          <label className="field-label md:col-span-6">
            Catatan
            <textarea
              name="notes"
              maxLength={4000}
              rows={2}
              className="field resize-y"
              placeholder="Instruksi khusus"
            />
          </label>

          <div className="md:col-span-12">
            <button
              type="submit"
              disabled={pending === "create"}
              className="btn btn-primary"
            >
              {pending === "create" ? "Menyimpan..." : "Tambah pesanan"}
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <p
          role="alert"
          className="rounded border border-[#e7c3be] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded border border-[#c7d5ad] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]"
        >
          {message}
        </p>
      ) : null}
      <div className="flex items-center gap-2 border-b border-[var(--line)] pb-2">
        <button
          type="button"
          onClick={() => setViewTab("ACTIVE")}
          className={`btn min-h-[44px] ${viewTab === "ACTIVE" ? "btn-primary" : "btn-quiet"}`}
        >
          Daftar Pesanan ({orders.length})
        </button>
        <button
          type="button"
          onClick={() => setViewTab("TRASH")}
          className={`btn min-h-[44px] ${viewTab === "TRASH" ? "btn-primary" : "btn-quiet"}`}
        >
          Sampah ({deletedOrders.length})
        </button>
      </div>

      <div
        className="panel overflow-hidden"
        aria-busy={pending !== null}
        aria-live="polite"
      >
        <div className="order-grid order-head border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2.5">
          <span className="eyebrow">Pelanggan</span>
          <span className="eyebrow">Pesanan</span>
          <span className="eyebrow">{viewTab === "TRASH" ? "Dihapus" : "Jadwal"}</span>
          <span className="eyebrow">Nilai</span>
          <span className="eyebrow">Pengerjaan</span>
          <span className="eyebrow">Pembayaran</span>
          <span className="eyebrow">Aksi</span>
        </div>

        {viewTab === "TRASH" ? (
          deletedOrders.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-medium">Kotak sampah kosong.</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Tidak ada pesanan yang dihapus dalam 30 hari terakhir.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {deletedOrders.map((order) => {
                const busy = pending === order.id;
                return (
                  <li key={order.id} className="order-grid order-row px-4 py-3 bg-[var(--surface-muted)]">
                    <div className="order-cell min-w-0">
                      <span className="cell-label">Pelanggan</span>
                      <div className="cell-value min-w-0">
                        <p className="font-medium text-stone-700">{order.customer_name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-[var(--muted)] truncate">
                            {order.customer_contact ?? "Kontak belum diisi"}
                          </span>
                          {order.customer_contact && order.customer_contact.replace(/\D/g, "").length >= 7 && (
                            <button
                              type="button"
                              onClick={() => handleToggleBlockCustomer(order.customer_contact!)}
                              className="text-[10px] text-stone-500 hover:text-red-600 underline cursor-pointer"
                              title="Blokir atau Buka Blokir pesan WhatsApp dari nomor ini"
                            >
                              Blokir
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="order-cell min-w-0">
                      <span className="cell-label">Pesanan</span>
                      <div className="cell-value min-w-0">
                        <p className="text-sm leading-5">{order.description}</p>
                      </div>
                    </div>

                    <div className="order-cell">
                      <span className="cell-label">Dihapus</span>
                      <div className="cell-value">
                        <p className="text-sm text-[var(--danger)]">
                          {order.deleted_at
                            ? formatLocalDateTime(order.deleted_at, timezone)
                            : "Waktu tidak tercatat"}
                        </p>
                      </div>
                    </div>

                    <div className="order-cell">
                      <span className="cell-label">Nilai</span>
                      <div className="cell-value">
                        <p className="text-sm">{money(order.total_amount)}</p>
                      </div>
                    </div>

                    <div className="order-cell">
                      <span className="cell-label">Pengerjaan</span>
                      <div className="cell-value">
                        <span className="badge badge-danger">Dihapus</span>
                      </div>
                    </div>

                    <div className="order-cell">
                      <span className="cell-label">Pembayaran</span>
                      <div className="cell-value">
                        <span className={paymentBadge(order.payment_status)}>
                          {paymentLabels[order.payment_status]}
                        </span>
                      </div>
                    </div>

                    <div className="order-cell">
                      <span className="cell-label">Aksi</span>
                      <div className="cell-value flex justify-end">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => restore(order)}
                          className="btn btn-secondary min-h-[44px]"
                        >
                          Pulihkan
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : orders.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-medium">Belum ada pesanan.</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Pesanan baru akan muncul di sini.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {orders.map((order) => {
              const busy = pending === order.id;
              return (
                <li key={order.id} className="order-grid order-row px-4 py-3">
                  <div className="order-cell min-w-0">
                    <span className="cell-label">Pelanggan</span>
                    <div className="cell-value min-w-0">
                      <p className="font-medium">{order.customer_name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-[var(--muted)] truncate">
                          {order.customer_contact ?? "Kontak belum diisi"}
                        </span>
                        {order.customer_contact && order.customer_contact.replace(/\D/g, "").length >= 7 && (
                          <button
                            type="button"
                            onClick={() => handleToggleBlockCustomer(order.customer_contact!)}
                            className="text-[10px] text-stone-500 hover:text-red-600 underline cursor-pointer"
                            title="Blokir atau Buka Blokir pesan WhatsApp dari nomor ini"
                          >
                            Blokir
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="order-cell min-w-0">
                    <span className="cell-label">Pesanan</span>
                    <div className="cell-value min-w-0">
                      <p className="text-sm leading-5">{order.description}</p>
                      {order.delivery_address ? (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          Kirim: {order.delivery_address}
                        </p>
                      ) : null}
                      {order.notes ? (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          Catatan: {order.notes}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="order-cell">
                    <span className="cell-label">Jadwal</span>
                    <div className="cell-value">
                      <p className="text-sm">
                        {order.delivery_date
                          ? formatLocalDateTime(order.delivery_date, timezone)
                          : "Kirim belum diisi"}
                      </p>
                      {order.event_date ? (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          Acara:{" "}
                          {formatLocalDateTime(order.event_date, timezone)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="order-cell">
                    <span className="cell-label">Nilai</span>
                    <div className="cell-value">
                      <p className="text-sm">{money(order.total_amount)}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        DP: {money(order.dp_amount)}
                      </p>
                    </div>
                  </div>
                  <div className="order-cell">
                    <span className="cell-label">Pengerjaan</span>
                    <div className="cell-value">
                      <span className={operationalBadge(order.status)}>
                        {operationalLabels[order.status ?? "PENDING"]}
                      </span>
                      <select
                        aria-label={`Status pengerjaan ${order.customer_name}`}
                        value={order.status ?? "PENDING"}
                        disabled={busy}
                        onChange={(changeEvent) =>
                          setOperationalStatus(
                            order.id,
                            changeEvent.target.value as OperationalStatus,
                          )
                        }
                        className="field mt-1 max-w-40 py-1 text-xs"
                      >
                        <option value="PENDING">Menunggu</option>
                        <option value="IN_PROGRESS">Dikerjakan</option>
                        <option value="COMPLETED">Selesai</option>
                        <option value="CANCELLED">Batal</option>
                      </select>
                    </div>
                  </div>


                  <div className="order-cell">
                    <span className="cell-label">Pembayaran</span>
                    <div className="cell-value">
                      <span className={paymentBadge(order.payment_status)}>
                        {paymentLabels[order.payment_status]}
                      </span>
                      <select
                        aria-label={`Status pembayaran ${order.customer_name}`}
                        value={order.payment_status}
                        disabled={busy}
                        onChange={(changeEvent) =>
                          setPayment(
                            order.id,
                            changeEvent.target.value as PaymentStatus,
                          )
                        }
                        className="field mt-1 max-w-40 py-1 text-xs"
                      >
                        <option value="UNPAID">Belum dibayar</option>
                        <option value="DP_PAID">DP dibayar</option>
                        <option value="PAID">Lunas</option>
                      </select>
                    </div>
                  </div>

                  <div className="order-cell">
                    <span className="cell-label">Aksi</span>
                    <div className="cell-value flex justify-end">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(order)}
                        className="btn btn-quiet text-[var(--danger)]"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
