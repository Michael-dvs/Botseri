import { prisma } from "@/lib/db";
import { formatLocalDate, formatLocalDateTime } from "@/lib/time";
import { maskChatId, truncateMessage } from "@/lib/analytics/helpers";

export const dynamic = "force-dynamic";

function levelBadge(level: string) {
  switch (level.toUpperCase()) {
    case "ERROR":
      return (
        <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
          ERROR
        </span>
      );
    case "WARN":
    case "WARNING":
      return <span className="badge badge-warning">WARN</span>;
    case "INFO":
    default:
      return <span className="badge">INFO</span>;
  }
}

function jobStatusBadge(status: string) {
  switch (status) {
    case "SENT":
      return <span className="badge badge-success">SENT</span>;
    case "CLAIMED":
      return <span className="badge">CLAIMED</span>;
    case "FAILED":
      return (
        <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
          FAILED
        </span>
      );
    case "SKIPPED":
      return <span className="badge badge-warning">SKIPPED</span>;
    default:
      return <span className="badge">{status}</span>;
  }
}

function directionBadge(direction: string) {
  if (direction === "INBOUND") {
    return (
      <span className="badge border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)] font-medium">
        MASUK
      </span>
    );
  }
  return <span className="badge badge-success font-medium">KELUAR</span>;
}

export default async function LogsPage() {
  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  const timezone = settings?.timezone ?? "Asia/Jakarta";

  const [events, jobs, messages] = await Promise.all([
    prisma.systemEvent
      .findMany({
        orderBy: [{ ts: "desc" }, { id: "desc" }],
        take: 100,
      })
      .catch(() => []),
    prisma.dailyExecutionLog
      .findMany({
        orderBy: [{ local_date: "desc" }, { claimed_at: "desc" }, { id: "desc" }],
        take: 50,
      })
      .catch(() => []),
    prisma.messageLog
      .findMany({
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: 50,
      })
      .catch(() => []),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow">Observabilitas</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Log Sistem</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Audit jejak eksekusi, event sistem, dan riwayat pesan WhatsApp.
        </p>
      </header>

      {/* 1. System Events (100 terakhir) */}
      <section className="panel p-5 sm:p-6" aria-labelledby="events-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="events-heading" className="text-lg font-semibold">
              System Events
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              100 kejadian sistem terbaru dari scheduler, gateway, dan bot engine.
            </p>
          </div>
          <span className="font-mono text-xs text-[var(--muted)]">
            {events.length} event
          </span>
        </div>

        {events.length === 0 ? (
          <div className="mt-4 rounded border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            Belum ada event sistem tercatat.
          </div>
        ) : (
          <div className="mt-4">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="py-2.5 font-medium">Waktu</th>
                    <th className="py-2.5 font-medium text-center">Level</th>
                    <th className="py-2.5 font-medium">Source</th>
                    <th className="py-2.5 font-medium font-mono">Code</th>
                    <th className="py-2.5 font-medium">Pesan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {events.map((event) => (
                    <tr key={event.id} className="hover:bg-[var(--surface-muted)]">
                      <td className="py-2.5 font-mono text-xs whitespace-nowrap">
                        {formatLocalDateTime(event.ts, timezone)}
                      </td>
                      <td className="py-2.5 text-center">{levelBadge(event.level)}</td>
                      <td className="py-2.5 font-mono text-xs">{event.source}</td>
                      <td className="py-2.5 font-mono text-xs">{event.code}</td>
                      <td className="py-2.5 text-xs max-w-md truncate">
                        {event.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Stack */}
            <div className="md:hidden space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
                >
                  <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {formatLocalDateTime(event.ts, timezone)}
                    </span>
                    {levelBadge(event.level)}
                  </div>
                  <div className="mt-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{event.source}</span>
                      <span className="font-mono text-[var(--muted)]">· {event.code}</span>
                    </div>
                    <p className="mt-1 text-[var(--ink)] break-words">
                      {event.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 2. Riwayat Job (50 terakhir) */}
      <section className="panel p-5 sm:p-6" aria-labelledby="jobs-history-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="jobs-history-heading" className="text-lg font-semibold">
              Riwayat Job Scheduler
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              50 job proaktif terakhir yang dijalankan oleh mesin scheduler.
            </p>
          </div>
          <span className="font-mono text-xs text-[var(--muted)]">
            {jobs.length} job
          </span>
        </div>

        {jobs.length === 0 ? (
          <div className="mt-4 rounded border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            Belum ada catatan job eksekusi.
          </div>
        ) : (
          <div className="mt-4">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="py-2.5 font-medium">Tanggal</th>
                    <th className="py-2.5 font-medium">Jenis</th>
                    <th className="py-2.5 font-medium text-center">Seq</th>
                    <th className="py-2.5 font-medium text-center">Status</th>
                    <th className="py-2.5 font-medium text-right">Percobaan</th>
                    <th className="py-2.5 font-medium">Claimed At</th>
                    <th className="py-2.5 font-medium">Sent At</th>
                    <th className="py-2.5 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-[var(--surface-muted)]">
                      <td className="py-2.5 font-medium whitespace-nowrap">
                        {formatLocalDate(job.local_date, timezone)}
                      </td>
                      <td className="py-2.5 font-mono text-xs">{job.job_type}</td>
                      <td className="py-2.5 text-center font-mono">{job.seq}</td>
                      <td className="py-2.5 text-center">{jobStatusBadge(job.status)}</td>
                      <td className="py-2.5 text-right font-mono">{job.attempts}</td>
                      <td className="py-2.5 font-mono text-xs whitespace-nowrap">
                        {formatLocalDateTime(job.claimed_at, timezone)}
                      </td>
                      <td className="py-2.5 font-mono text-xs whitespace-nowrap">
                        {job.sent_at
                          ? formatLocalDateTime(job.sent_at, timezone)
                          : "Belum terkirim"}
                      </td>
                      <td className="py-2.5 text-xs text-[var(--muted)] max-w-xs truncate">
                        {job.error ? truncateMessage(job.error, 60) : "Tidak ada"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Stack */}
            <div className="md:hidden space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
                >
                  <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                    <div>
                      <span className="font-semibold">
                        {formatLocalDate(job.local_date, timezone)}
                      </span>
                      <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                        {job.job_type}
                      </span>
                    </div>
                    {jobStatusBadge(job.status)}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-[var(--muted)]">Seq / Percobaan</dt>
                      <dd className="font-mono font-medium">
                        Seq {job.seq} · {job.attempts}x
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Waktu Claim</dt>
                      <dd className="font-mono font-medium">
                        {formatLocalDateTime(job.claimed_at, timezone)}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[var(--muted)]">Waktu Kirim</dt>
                      <dd className="font-mono font-medium">
                        {job.sent_at
                          ? formatLocalDateTime(job.sent_at, timezone)
                          : "Belum terkirim"}
                      </dd>
                    </div>
                    {job.error ? (
                      <div className="col-span-2">
                        <dt className="text-[var(--danger)]">Error</dt>
                        <dd className="text-xs text-[var(--danger)]">
                          {truncateMessage(job.error, 100)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 3. Message Log (50 terakhir) */}
      <section className="panel p-5 sm:p-6" aria-labelledby="messages-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="messages-heading" className="text-lg font-semibold">
              Message Log
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              50 pesan WhatsApp terakhir (nomor chat ter-masking untuk privasi).
            </p>
          </div>
          <span className="font-mono text-xs text-[var(--muted)]">
            {messages.length} pesan
          </span>
        </div>

        {messages.length === 0 ? (
          <div className="mt-4 rounded border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            Belum ada catatan pesan WhatsApp.
          </div>
        ) : (
          <div className="mt-4">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="py-2.5 font-medium">Waktu</th>
                    <th className="py-2.5 font-medium text-center">Arah</th>
                    <th className="py-2.5 font-medium">Chat ID</th>
                    <th className="py-2.5 font-medium">Isi Pesan / Transkrip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {messages.map((message) => {
                    const text = message.body ?? message.transcript ?? "";
                    return (
                      <tr key={message.id} className="hover:bg-[var(--surface-muted)]">
                        <td className="py-2.5 font-mono text-xs whitespace-nowrap">
                          {formatLocalDateTime(message.created_at, timezone)}
                        </td>
                        <td className="py-2.5 text-center">
                          {directionBadge(message.direction)}
                        </td>
                        <td className="py-2.5 font-mono text-xs whitespace-nowrap">
                          {maskChatId(message.chat_id)}
                        </td>
                        <td className="py-2.5 text-xs max-w-xl truncate">
                          {text ? truncateMessage(text, 120) : "Pesan kosong atau media tanpa transkrip"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Stack */}
            <div className="md:hidden space-y-3">
              {messages.map((message) => {
                const text = message.body ?? message.transcript ?? "";
                return (
                  <div
                    key={message.id}
                    className="rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
                  >
                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                      <span className="font-mono text-xs text-[var(--muted)]">
                        {formatLocalDateTime(message.created_at, timezone)}
                      </span>
                      {directionBadge(message.direction)}
                    </div>
                    <div className="mt-2 text-xs">
                      <p className="font-mono text-[var(--muted)]">
                        Chat: {maskChatId(message.chat_id)}
                      </p>
                      <p className="mt-1 text-[var(--ink)] break-words">
                        {text ? truncateMessage(text, 120) : "Pesan kosong atau media tanpa transkrip"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
