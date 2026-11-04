export default function AppLoading() {
  return (
    <div
      className="panel flex min-h-40 items-center justify-center p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="text-sm text-[var(--muted)]">Memuat panel...</p>
    </div>
  );
}
