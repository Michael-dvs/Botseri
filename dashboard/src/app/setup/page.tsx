"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const fields: Array<[string, string, string]> = [
  ["brand_name", "Nama usaha", "text"],
  ["business_type", "Bidang usaha", "text"],
  ["owner_name", "Nama pemilik", "text"],
  ["username", "Username admin", "text"],
  ["password", "Password (minimal 12 karakter)", "password"],
  ["setup_token", "Setup token dari log container", "text"],
];

export default function SetupPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brand_name: form.get("brand_name"),
        business_type: form.get("business_type"),
        owner_name: form.get("owner_name"),
        username: form.get("username"),
        password: form.get("password"),
        setup_token: form.get("setup_token"),
        enable_orders: form.get("enable_orders") === "on",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      router.push("/dashboard");
      return;
    }
    setLoading(false);
    setError(body.error ?? "Setup gagal");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div>
        <p className="eyebrow">Bootstrap</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Setup Botseri
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Isi data usaha dan akun admin. Setup hanya bisa dilakukan sekali.
        </p>
      </div>
      <form onSubmit={submit} className="panel flex flex-col gap-3 p-6">
        {fields.map(([name, label, type]) => (
          <label key={name} className="field-label">
            {label}
            <input
              name={name}
              type={type}
              required
              autoComplete={name === "password" ? "new-password" : "off"}
              className="field"
            />
          </label>
        ))}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded border border-[var(--line)] px-3 py-2 text-sm">
          <input
            name="enable_orders"
            type="checkbox"
            defaultChecked
            className="size-4 rounded accent-[var(--accent)]"
          />
          <span>
            <span className="block font-medium text-[var(--ink)]">
              Aktifkan Modul Pesanan Pelanggan (Khusus UMKM / Jasa)
            </span>
            <span className="block text-xs text-[var(--muted)]">
              Centang jika bot digunakan untuk mendata pesanan pelanggan dan jadwal pengiriman. Hapus centang untuk mode to-do pribadi.
            </span>
          </span>
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded border border-[#e7c3be] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary"
        >
          {loading ? "Menyimpan..." : "Selesaikan setup"}
        </button>
      </form>
    </main>
  );
}
