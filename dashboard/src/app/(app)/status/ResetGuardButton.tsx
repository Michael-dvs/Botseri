"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResetGuardButton({ isCooldown }: { isCooldown: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleReset() {
    if (
      !window.confirm(
        "Apakah Anda yakin ingin mereset Circuit Breaker WAHA? DILARANG KERAS mereset jika WhatsApp Web sedang menampilkan pembatasan akun Meta."
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/waha/guard/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || "Gagal mereset guard.");
      } else {
        router.refresh();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleReset}
      disabled={loading}
      className={`btn min-h-7 px-2.5 text-[11px] font-medium cursor-pointer ${
        isCooldown ? "btn-danger" : "btn-outline"
      }`}
      title="Reset status Circuit Breaker WAHA ke NORMAL"
    >
      {loading ? "Mereset..." : "Reset Guard"}
    </button>
  );
}
