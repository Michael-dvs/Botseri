import { prisma } from "@/lib/db";
import { getGoogleRow } from "@/lib/google/oauth";
import { formatLocalDate, formatLocalDateTime } from "@/lib/time";
import { getSessionStatus } from "@/lib/waha/client";
import { getSchedulerStaleMinutes, tickHealth, truncateMessage } from "@/lib/analytics/helpers";
import { getWahaCircuitBreakerStatus } from "@/lib/waha/humanizer";

export const dynamic = "force-dynamic";
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    const res = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return res;
  } catch {
    clearTimeout(timer);
    return fallback;
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

export default async function StatusPage() {
  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  const timezone = settings?.timezone ?? "Asia/Jakarta";
  const now = new Date();

  // Run all checks in parallel with explicit 3-second timeout and try/catch isolation
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000);

  // Run all checks in parallel with explicit 3-second timeout and try/catch isolation
  const [
    dbStatus,
    wahaStatus,
    googleRow,
    activeLlm,
    lastTickEvent,
    pendingSyncCount,
    stuckSyncCount,
    lastJobs,
    alarmStats,
    wahaBreaker,
    llmThrottleCount,
    waitingSessions,
    pipelineRow,
    tickOverlapCount,
  ] = await Promise.all([
    // 1. DB
    withTimeout(
      prisma
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
      3000,
      false,
    ),
    // 2. WAHA
    withTimeout(
      getSessionStatus().catch(() => ({ status: "UNREACHABLE" })),
      3000,
      { status: "UNREACHABLE" },
    ),
    // 3. Google OAuth
    withTimeout(
      getGoogleRow().catch(() => null),
      3000,
      null,
    ),
    // 4. LLM Config
    withTimeout(
      prisma.llmConfig
        .findFirst({
          where: { is_active: true },
          select: { provider: true, model: true },
        })
        .catch(() => null),
      3000,
      null,
    ),
    // 5. Last Tick Event
    withTimeout(
      prisma.systemEvent
        .findFirst({
          where: { source: "SCHEDULER", code: "TICK_OK" },
          orderBy: { ts: "desc" },
        })
        .catch(() => null),
      3000,
      null,
    ),
    // 6. Pending Google syncs (PENDING + FAILED)
    withTimeout(
      prisma.todo
        .count({
          where: { google_sync_status: { in: ["PENDING", "FAILED"] } },
        })
        .catch(() => 0),
      3000,
      0,
    ),
    // 7. Stuck Google syncs (FAILED and attempts >= 8)
    withTimeout(
      prisma.todo
        .count({
          where: {
            google_sync_status: "FAILED",
            google_sync_attempts: { gte: 8 },
          },
        })
        .catch(() => 0),
      3000,
      0,
    ),
    // 8. Last 10 jobs
    withTimeout(
      prisma.dailyExecutionLog
        .findMany({
          orderBy: [{ local_date: "desc" }, { claimed_at: "desc" }],
          take: 10,
        })
        .catch(() => []),
      3000,
      [],
    ),
    // 9. Alarm 24 Jam stats
    withTimeout(
      Promise.all([
        prisma.todo.count({
          where: { status: "PENDING", has_specific_time: true, reminded_at: null, reminder_expired_at: null },
        }),
        prisma.todo.count({
          where: { reminded_at: { gte: twentyFourHoursAgo } },
        }),
        prisma.todo.count({
          where: { reminder_expired_at: { gte: twentyFourHoursAgo } },
        }),
        prisma.todo.count({
          where: { status: "PENDING", reminder_attempts: { gte: 5 } },
        }),
      ]).then(([pending, sent, expired, failed]) => ({ pending, sent, expired, failed })),
      3000,
      { pending: 0, sent: 0, expired: 0, failed: 0 },
    ),
    // 10. WAHA Breaker
    withTimeout(
      Promise.resolve(getWahaCircuitBreakerStatus(now)),
      3000,
      { status: "NORMAL" as const, cooldown_remaining_seconds: 0, consecutive_failures: 0 },
    ),
    // 11. LLM Throttle (HTTP 429) count (24h)
    withTimeout(
      prisma.systemEvent.count({
        where: {
          ts: { gte: twentyFourHoursAgo },
          OR: [
            { code: "LLM_RATE_LIMITED" },
            { message: { contains: "429" } },
          ],
        },
      }),
      3000,
      0,
    ),
    // 12. Sesi Pelanggan Menunggu
    withTimeout(
      prisma.customerSession.findMany({
        where: {
          OR: [
            { state: "PAUSED_FOR_OWNER" },
            { paused_at: { not: null } },
          ],
        },
        select: { paused_at: true, metadata: true, phone_e164: true },
        take: 50,
      }),
      3000,
      [],
    ),
    // 13. Pipeline Version
    withTimeout(
      prisma.pipelineConfig.findUnique({
        where: { id: 1 },
        select: { version: true },
      }),
      3000,
      null,
    ),
    // 14. Tick Overlap (24h)
    withTimeout(
      prisma.systemEvent.count({
        where: {
          source: "SCHEDULER",
          code: "TICK_OVERLAP",
          ts: { gte: twentyFourHoursAgo },
        },
      }),
      3000,
      0,
    ),
  ]);

  const staleMinutes = getSchedulerStaleMinutes();
  const tickCondition = tickHealth(now, lastTickEvent?.ts, staleMinutes);
  const tickAgeMinutes = lastTickEvent
    ? Math.max(0, Math.floor((now.getTime() - lastTickEvent.ts.getTime()) / 60_000))
    : null;

  const isTickAmber = tickCondition !== "OK";
  const googleStatus = googleRow?.status ?? "DISCONNECTED";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow">Observabilitas</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Status Sistem</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Kesehatan komponen infrastruktur, detak scheduler, dan riwayat eksekusi job bot.
        </p>
      </header>

      {/* Amber banner when scheduler tick is stale or never run (R-25, R-27) */}
      {isTickAmber ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded border border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning)]"
        >
          <span aria-hidden="true" className="font-bold text-base leading-none">
            [!]
          </span>
          <div>
            <p className="font-semibold">Peringatan: Detak Scheduler Tidak Segar</p>
            <p className="mt-0.5 text-xs text-[var(--warning)]">
              {tickCondition === "NEVER"
                ? "Detak scheduler belum pernah tercatat. Periksa kontainer botseri-n8n dan log scheduler."
                : `Detak scheduler tertunda lebih dari ${staleMinutes} menit. Periksa kontainer n8n dan log scheduler.`}
            </p>
          </div>
        </div>
      ) : null}
      {/* Grid Status Komponen */}
      <section aria-labelledby="components-heading">
        <h2 id="components-heading" className="sr-only">
          Status Komponen
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Database */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Database</p>
              {dbStatus ? (
                <span className="badge badge-success">OK</span>
              ) : (
                <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
                  GAGAL
                </span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold">
              {dbStatus ? (
                <span className="text-[var(--success)]">Terhubung</span>
              ) : (
                <span className="text-[var(--danger)]">Tidak Terhubung</span>
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              PostgreSQL port 5432 internal.
            </p>
          </div>

          {/* WAHA */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">WhatsApp (WAHA)</p>
              {wahaStatus.status === "WORKING" ? (
                <span className="badge badge-success">OK</span>
              ) : wahaStatus.status === "SCAN_QR_CODE" ? (
                <span className="badge badge-warning">PERLU SCAN</span>
              ) : (
                <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
                  {wahaStatus.status}
                </span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold font-mono">
              {wahaStatus.status}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {wahaStatus.status === "WORKING"
                ? "Sesi bot aktif dan siap bertukar pesan."
                : wahaStatus.status === "SCAN_QR_CODE"
                  ? "Buka menu Integrasi untuk memindai kode QR."
                  : "Periksa container botseri-waha."}
            </p>
          </div>

          {/* Google OAuth */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Google OAuth</p>
              {googleStatus === "CONNECTED" ? (
                <span className="badge badge-success">CONNECTED</span>
              ) : googleStatus === "NEEDS_REAUTH" ? (
                <span className="badge badge-warning">NEEDS_REAUTH</span>
              ) : (
                <span className="badge">DISCONNECTED</span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold">
              {googleRow?.account_email ? (
                <span className="truncate block text-base font-normal">
                  {googleRow.account_email}
                </span>
              ) : (
                googleStatus
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {googleStatus === "CONNECTED"
                ? "Sinkronisasi kalender dan tugas siap."
                : googleStatus === "NEEDS_REAUTH"
                  ? "Token kedaluwarsa, lakukan otorisasi ulang di Integrasi."
                  : "Belum dihubungkan dengan Google."}
            </p>
          </div>

          {/* LLM Gateway */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">LLM Aktif</p>
              {activeLlm ? (
                <span className="badge badge-success">AKTIF</span>
              ) : (
                <span className="badge badge-warning">BELUM DIATUR</span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold truncate">
              {activeLlm ? activeLlm.model : "Belum dikonfigurasi"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {activeLlm ? `Provider: ${activeLlm.provider}` : "Pilih model di menu Integrasi."}
            </p>
          </div>

          {/* Scheduler Heartbeat */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Detak Scheduler</p>
              {tickCondition === "OK" ? (
                <span className="badge badge-success">SEGAR</span>
              ) : tickCondition === "STALE" ? (
                <span className="badge badge-warning">STALE</span>
              ) : (
                <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
                  NEVER
                </span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold">
              {tickAgeMinutes !== null
                ? `${tickAgeMinutes} menit lalu`
                : "Belum pernah"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {lastTickEvent
                ? formatLocalDateTime(lastTickEvent.ts, timezone)
                : "Tidak ada event TICK_OK."}
            </p>
          </div>

          {/* Sinkronisasi Google Tertunda */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Sinkronisasi Google</p>
              {stuckSyncCount > 0 ? (
                <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
                  {stuckSyncCount} MACET
                </span>
              ) : pendingSyncCount > 0 ? (
                <span className="badge badge-warning">{pendingSyncCount} TERTUNDA</span>
              ) : (
                <span className="badge badge-success">LANCAR</span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold font-mono">
              {pendingSyncCount} tertunda
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {stuckSyncCount > 0
                ? `${stuckSyncCount} tugas mencapai batas 8 percobaan (butuh intervensi).`
                : "Semua antrean sinkronisasi dalam batas wajar."}
            </p>
          </div>

          {/* Alarm Tugas 24 Jam */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Alarm Tugas (24 Jam)</p>
              {alarmStats.expired > 0 ? (
                <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
                  {alarmStats.expired} KEDALUWARSA
                </span>
              ) : (
                <span className="badge badge-success">LANCAR</span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold font-mono">
              {alarmStats.sent} terkirim · {alarmStats.pending} aktif
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {alarmStats.expired > 0
                ? `${alarmStats.expired} alarm terlewat > 12 jam (ditampilkan di brief).`
                : "Tidak ada alarm yang terlewat > 12 jam."}
            </p>
          </div>

          {/* Circuit Breaker WAHA */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Circuit Breaker WAHA</p>
              {wahaBreaker.status === "NORMAL" ? (
                <span className="badge badge-success">NORMAL</span>
              ) : (
                <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
                  COOLDOWN ({wahaBreaker.cooldown_remaining_seconds}s)
                </span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold">
              {wahaBreaker.status === "NORMAL" ? (
                <span className="text-[var(--success)]">Lancar</span>
              ) : (
                <span className="text-[var(--danger)]">Sedang Dibatasi</span>
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {wahaBreaker.consecutive_failures > 0
                ? `${wahaBreaker.consecutive_failures} kegagalan beruntun tercatat.`
                : "0 kegagalan beruntun."}
            </p>
          </div>

          {/* LLM Throttle 429 */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">LLM Throttle (429)</p>
              {llmThrottleCount > 0 ? (
                <span className="badge badge-warning">{llmThrottleCount} TERHAMBAT</span>
              ) : (
                <span className="badge badge-success">0 ERROR</span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold font-mono">
              {llmThrottleCount} kejadian
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Total error HTTP 429 rate limit dalam 24 jam terakhir.
            </p>
          </div>

          {/* Sesi Pelanggan Menunggu */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Sesi Pelanggan Menunggu</p>
              {waitingSessions.length > 0 ? (
                <span className="badge badge-warning">{waitingSessions.length} MENUNGGU</span>
              ) : (
                <span className="badge badge-success">NIHIL</span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold font-mono">
              {waitingSessions.length} sesi
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {waitingSessions.length > 0
                ? `Menunggu respons manual owner WhatsApp.`
                : "Tidak ada sesi pelanggan yang dibisukan."}
            </p>
          </div>

          {/* Versi Pipeline */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Versi Pipeline</p>
              <span className="badge badge-success">v{pipelineRow?.version ?? 1}</span>
            </div>
            <p className="mt-2 text-xl font-semibold font-mono">
              Versi {pipelineRow?.version ?? 1}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Graf alur kerja visual aktif di runtime (SSOT).
            </p>
          </div>

          {/* Tick Overlap */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Tick Overlap (24 Jam)</p>
              {tickOverlapCount > 0 ? (
                <span className="badge badge-warning">{tickOverlapCount} OVERLAP</span>
              ) : (
                <span className="badge badge-success">0 OVERLAP</span>
              )}
            </div>
            <p className="mt-2 text-xl font-semibold font-mono">
              {tickOverlapCount} dicegah
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Pencegahan tumpang tindih eksekusi via scheduler_locks.
            </p>
          </div>
        </div>
      </section>

      {/* Tabel 10 Job Terakhir */}
      <section className="panel p-5 sm:p-6" aria-labelledby="jobs-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="jobs-heading" className="text-lg font-semibold">
              10 Job Terakhir
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Catatan eksekusi proaktif terjadwal dari daily_execution_logs.
            </p>
          </div>
        </div>

        {lastJobs.length === 0 ? (
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
                    <th className="py-2.5 font-medium">Jenis Job</th>
                    <th className="py-2.5 font-medium text-center">Seq</th>
                    <th className="py-2.5 font-medium text-center">Status</th>
                    <th className="py-2.5 font-medium text-right">Percobaan</th>
                    <th className="py-2.5 font-medium">Pesan Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {lastJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-[var(--surface-muted)]">
                      <td className="py-2.5 font-medium">
                        {formatLocalDate(job.local_date, timezone)}
                      </td>
                      <td className="py-2.5 font-mono text-xs">{job.job_type}</td>
                      <td className="py-2.5 text-center font-mono">{job.seq}</td>
                      <td className="py-2.5 text-center">{jobStatusBadge(job.status)}</td>
                      <td className="py-2.5 text-right font-mono">{job.attempts}</td>
                      <td className="py-2.5 text-xs text-[var(--muted)] max-w-xs truncate">
                        {job.error ? truncateMessage(job.error, 80) : "Tidak ada"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Stack */}
            <div className="md:hidden space-y-3">
              {lastJobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
                >
                  <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                    <span className="font-semibold">
                      {formatLocalDate(job.local_date, timezone)}
                    </span>
                    {jobStatusBadge(job.status)}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-[var(--muted)]">Jenis Job</dt>
                      <dd className="font-mono font-medium">{job.job_type}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Seq / Percobaan</dt>
                      <dd className="font-mono font-medium">
                        Seq {job.seq} · {job.attempts}x
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
    </div>
  );
}
