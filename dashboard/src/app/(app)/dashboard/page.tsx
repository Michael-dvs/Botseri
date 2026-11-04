import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatLocalDateTime, localDateString } from "@/lib/time";

type FocusRow = {
  id: string;
  title: string;
  priority_rank: number;
  priority_label: string | null;
  due_at: Date | null;
  planned_date: Date;
};

const googleLabels = {
  CONNECTED: "Terhubung",
  NEEDS_REAUTH: "Perlu otorisasi ulang",
  DISCONNECTED: "Terputus",
} as const;

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });
  const today = localDateString(new Date(), settings.timezone);
  const todayDate = new Date(`${today}T00:00:00Z`);

  const [target, done, focus, llm, google] = await Promise.all([
    prisma.todo.count({
      where: { planned_date: todayDate, status: { not: "CANCELLED" } },
    }),
    prisma.todo.count({
      where: { planned_date: todayDate, status: "DONE" },
    }),
    prisma.$queryRaw<FocusRow[]>`
      SELECT id, title, priority_rank, priority_label, due_at, planned_date
      FROM v_active_todos
      WHERE planned_date <= ${todayDate}
      LIMIT 3
    `,
    prisma.llmConfig.findFirst({ where: { is_active: true } }),
    prisma.oAuthToken.findFirst({ where: { provider: "google" } }),
  ]);

  const rate = target > 0 ? Math.round((done / target) * 100) : null;
  const googleLabel = google ? googleLabels[google.status] : "Belum terhubung";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Ringkasan operasional</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Hari ini
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {today} · {settings.timezone} · {settings.brand_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/todos" className="btn btn-primary">
            Buka papan to-do
          </Link>
          {settings.enable_orders ? (
            <Link href="/orders" className="btn btn-secondary">
              Catat pesanan
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
        <section className="panel p-5 sm:p-6" aria-labelledby="completion">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="completion" className="text-lg font-semibold">
                Penyelesaian tugas
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Tugas dengan rencana hari ini, tanpa yang dibatalkan.
              </p>
            </div>
            <p className="font-mono text-xl font-semibold">
              {done} / {target}
            </p>
          </div>

          <div className="mt-6 flex items-end gap-4">
            <p className="text-5xl font-semibold tracking-tight">
              {rate === null ? "Belum ada" : `${rate}%`}
            </p>
            <p className="pb-1 text-sm text-[var(--muted)]">
              {rate === null
                ? "Belum ada tugas untuk hari ini."
                : `${done} selesai dari ${target} tugas.`}
            </p>
          </div>

          <div
            className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"
            role="img"
            aria-label={
              rate === null
                ? "Belum ada progres tugas hari ini"
                : `Progres penyelesaian ${rate} persen`
            }
          >
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${rate ?? 0}%` }}
            />
          </div>
        </section>

        <section className="panel p-5 sm:p-6" aria-labelledby="integrations">
          <h2 id="integrations" className="text-lg font-semibold">
            Konfigurasi aktif
          </h2>
          <dl className="mt-4 divide-y divide-[var(--line)] text-sm">
            <div className="flex items-start justify-between gap-4 py-3 first:pt-0">
              <dt className="text-[var(--muted)]">LLM</dt>
              <dd className="text-right">
                {llm ? (
                  <>
                    <span className="badge badge-success">Aktif</span>
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      {llm.provider} · {llm.model}
                    </span>
                  </>
                ) : (
                  <span className="badge badge-warning">Belum diatur</span>
                )}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-3">
              <dt className="text-[var(--muted)]">Google</dt>
              <dd className="text-right">
                <span
                  className={`badge ${
                    google?.status === "CONNECTED"
                      ? "badge-success"
                      : google
                        ? "badge-warning"
                        : ""
                  }`}
                >
                  {googleLabel}
                </span>
                {google?.account_email ? (
                  <span className="mt-1 block max-w-48 truncate text-xs text-[var(--muted)]">
                    {google.account_email}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-3">
              <dt className="text-[var(--muted)]">Prompt</dt>
              <dd className="text-right">
                <span className="badge">
                  {settings.prompt_mode} · v{settings.compiled_prompt_version}
                </span>
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="panel p-5 sm:p-6" aria-labelledby="focus">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Urutan kerja</p>
            <h2 id="focus" className="mt-1 text-xl font-semibold">
              3 Fokus Utama
            </h2>
          </div>
          <Link
            href="/priority-stack"
            className="text-sm font-medium text-[var(--accent-strong)] underline-offset-4 hover:underline"
          >
            Atur priority stack
          </Link>
        </div>

        {focus.length === 0 ? (
          <div className="mt-5 rounded border border-dashed border-[var(--line)] p-6 text-center">
            <p className="font-medium">Belum ada tugas aktif.</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Tambahkan tugas pertama untuk melihat fokus hari ini.
            </p>
            <Link href="/todos" className="btn btn-secondary mt-4">
              Tambah tugas
            </Link>
          </div>
        ) : (
          <ol className="mt-4 divide-y divide-[var(--line)]">
            {focus.map((todo, index) => (
              <li
                key={todo.id}
                className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-start"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-sm font-semibold text-[var(--accent)]"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="font-medium leading-6">{todo.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Rencana {todo.planned_date.toISOString().slice(0, 10)}
                    {todo.due_at
                      ? ` · Tenggat ${formatLocalDateTime(
                          todo.due_at,
                          settings.timezone,
                        )}`
                      : " · Tanpa jam tenggat"}
                  </p>
                </div>
                <span className="badge">
                  {todo.priority_label ?? `Rank ${todo.priority_rank}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
