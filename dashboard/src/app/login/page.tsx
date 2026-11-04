"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      router.push("/dashboard");
      return;
    }
    setLoading(false);
    setError(body.error ?? "Login gagal");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <p className="eyebrow">Panel operasional</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Masuk Botseri
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Kelola to-do, pesanan, dan prioritas usaha.
        </p>
      </div>
      <form onSubmit={submit} className="panel flex flex-col gap-4 p-6">
        <label className="field-label">
          Username
          <input
            name="username"
            required
            autoComplete="username"
            className="field"
          />
        </label>
        <label className="field-label">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field"
          />
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
          {loading ? "Memeriksa..." : "Masuk"}
        </button>
      </form>
    </main>
  );
}
