"use client";

import Link from "next/link";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel mx-auto max-w-2xl p-6" role="alert">
      <p className="eyebrow">Gangguan</p>
      <h1 className="mt-1 text-2xl font-semibold">
        Panel tidak dapat dimuat.
      </h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        Coba muat ulang panel. Jika masalah berlanjut, periksa koneksi database
        dan log container dashboard.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Coba lagi
        </button>
        <Link href="/dashboard" className="btn btn-secondary">
          Kembali ke dashboard
        </Link>
      </div>
    </div>
  );
}
