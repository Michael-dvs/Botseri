import { addDays, format } from "date-fns";
import { prisma } from "@/lib/db";
import { dateOnlyToDate, formatLocalDate, localDateString } from "@/lib/time";
import {
  safeDecimal,
  summarizeStats,
  usageDateCutoff,
} from "@/lib/analytics/helpers";

export const dynamic = "force-dynamic";

type UsageRow = {
  day: string;
  call_type: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  errors: number;
};

type RawUsageRow = {
  day: Date | string;
  call_type: string;
  calls: bigint;
  prompt_tokens: bigint;
  completion_tokens: bigint;
  cost_usd: string;
  errors: bigint;
};

function formatUsd(amount: number): string {
  if (amount === 0) return "$0.0000";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(amount);
}

function tierBadge(tier: string) {
  switch (tier) {
    case "HIGH":
      return <span className="badge badge-success">HIGH</span>;
    case "MID":
      return <span className="badge badge-warning">MID</span>;
    case "LOW":
      return (
        <span className="badge border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] font-medium">
          LOW
        </span>
      );
    case "NO_TASKS":
    default:
      return <span className="badge">NO_TASKS</span>;
  }
}

export default async function AnalyticsPage() {
  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  const timezone = settings?.timezone ?? "Asia/Jakarta";

  const now = new Date();
  const todayStr = localDateString(now, timezone);
  const anchor = new Date(`${todayStr}T00:00:00Z`);
  const earliestDateStr = format(addDays(anchor, -29), "yyyy-MM-dd");
  const cutoffDate = dateOnlyToDate(earliestDateStr);
  const cutoffUtc = usageDateCutoff(now, timezone, 30);

  let statsError = false;
  let usageError = false;
  let statsRows: Array<{
    local_date: Date;
    target_count: number;
    done_count: number;
    pending_count: number;
    completion_rate: number | null;
    tier: string;
    rolled_over_count: number;
  }> = [];
  let usageList: UsageRow[] = [];

  try {
    const rawStats = await prisma.dailyStat.findMany({
      where: { local_date: { gte: cutoffDate } },
      orderBy: { local_date: "desc" },
    });
    statsRows = rawStats.map((row) => ({
      local_date: row.local_date,
      target_count: row.target_count,
      done_count: row.done_count,
      pending_count: row.pending_count,
      completion_rate:
        row.completion_rate !== null ? safeDecimal(row.completion_rate) : null,
      tier: row.tier,
      rolled_over_count: row.rolled_over_count,
    }));
  } catch {
    statsError = true;
  }

  try {
    const rawUsage = await prisma.$queryRaw<RawUsageRow[]>`
      SELECT
        date_trunc('day', ts AT TIME ZONE ${timezone})::date AS day,
        call_type,
        COUNT(*)::bigint AS calls,
        COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
        COALESCE(SUM(cost_usd), 0)::text AS cost_usd,
        COUNT(*) FILTER (WHERE success = false)::bigint AS errors
      FROM llm_usage_logs
      WHERE ts >= ${cutoffUtc}
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2 ASC
    `;

    usageList = rawUsage.map((row) => ({
      day:
        row.day instanceof Date
          ? format(row.day, "yyyy-MM-dd")
          : String(row.day).slice(0, 10),
      call_type: row.call_type,
      calls: Number(row.calls),
      prompt_tokens: Number(row.prompt_tokens),
      completion_tokens: Number(row.completion_tokens),
      cost_usd: Number(row.cost_usd),
      errors: Number(row.errors),
    }));
  } catch {
    usageError = true;
  }

  const summary = summarizeStats(statsRows);
  const totalCostUsd = usageList.reduce((sum, r) => sum + r.cost_usd, 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow">Observabilitas</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Analitik</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Ringkasan performa to-do harian dan estimasi biaya LLM 30 hari terakhir.
        </p>
      </header>

      {/* Ringkasan 30 hari */}
      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">
          Ringkasan 30 Hari
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="panel p-4">
            <p className="eyebrow">Tugas selesai (30 hari)</p>
            <p className="mt-2 text-2xl font-semibold">
              {statsError ? (
                <span className="text-[var(--danger)] text-base font-normal">
                  Gagal memuat
                </span>
              ) : summary.total_target === 0 && summary.total_done === 0 ? (
                "Belum ada data"
              ) : (
                `${summary.total_done} dari ${summary.total_target}`
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Total target dan penyelesaian tugas.
            </p>
          </div>

          <div className="panel p-4">
            <p className="eyebrow">Rata-rata completion rate</p>
            <p className="mt-2 text-2xl font-semibold">
              {statsError ? (
                <span className="text-[var(--danger)] text-base font-normal">
                  Gagal memuat
                </span>
              ) : summary.average_rate === null ? (
                "Belum ada data"
              ) : (
                `${summary.average_rate.toFixed(1)}%`
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Rata-rata hari aktif dengan target.
            </p>
          </div>

          <div className="panel p-4 sm:col-span-2 lg:col-span-1">
            <p className="eyebrow">Estimasi biaya LLM (30 hari)</p>
            <p className="mt-2 text-2xl font-semibold">
              {usageError ? (
                <span className="text-[var(--danger)] text-base font-normal">
                  Gagal memuat
                </span>
              ) : (
                formatUsd(totalCostUsd)
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Estimasi berbasis token input dan output.
            </p>
          </div>
        </div>
      </section>

      {/* Tabel Completion Rate Harian */}
      <section className="panel p-5 sm:p-6" aria-labelledby="daily-stats-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="daily-stats-heading" className="text-lg font-semibold">
              Completion Rate Harian
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Hasil evaluasi harian bot per tanggal kerja lokal.
            </p>
          </div>
        </div>

        {statsError ? (
          <div className="mt-4 rounded border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
            Gagal memuat data statistik harian. Silakan muat ulang halaman.
          </div>
        ) : statsRows.length === 0 ? (
          <div className="mt-4 rounded border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            Belum ada data untuk 30 hari terakhir.
          </div>
        ) : (
          <div className="mt-4">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="py-2.5 font-medium">Tanggal</th>
                    <th className="py-2.5 font-medium text-right">Target</th>
                    <th className="py-2.5 font-medium text-right">Selesai</th>
                    <th className="py-2.5 font-medium text-right">Rate</th>
                    <th className="py-2.5 font-medium text-center">Tier</th>
                    <th className="py-2.5 font-medium text-right">Rollover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {statsRows.map((row) => (
                    <tr key={row.local_date.toISOString()} className="hover:bg-[var(--surface-muted)]">
                      <td className="py-2.5 font-medium">
                        {formatLocalDate(row.local_date, timezone)}
                      </td>
                      <td className="py-2.5 text-right font-mono">{row.target_count}</td>
                      <td className="py-2.5 text-right font-mono">{row.done_count}</td>
                      <td className="py-2.5 text-right font-mono">
                        {row.completion_rate !== null
                          ? `${row.completion_rate.toFixed(1)}%`
                          : "Belum ada"}
                      </td>
                      <td className="py-2.5 text-center">{tierBadge(row.tier)}</td>
                      <td className="py-2.5 text-right font-mono">{row.rolled_over_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Stack (R-03: no horizontal overflow at 360px) */}
            <div className="md:hidden space-y-3">
              {statsRows.map((row) => (
                <div
                  key={row.local_date.toISOString()}
                  className="rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
                >
                  <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                    <span className="font-semibold">
                      {formatLocalDate(row.local_date, timezone)}
                    </span>
                    {tierBadge(row.tier)}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-[var(--muted)]">Target / Selesai</dt>
                      <dd className="font-mono font-medium">
                        {row.done_count} dari {row.target_count}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Completion Rate</dt>
                      <dd className="font-mono font-medium">
                        {row.completion_rate !== null
                          ? `${row.completion_rate.toFixed(1)}%`
                          : "Belum ada"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Tugas Rollover</dt>
                      <dd className="font-mono font-medium">{row.rolled_over_count}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Tabel Token dan Biaya per Call Type */}
      <section className="panel p-5 sm:p-6" aria-labelledby="llm-usage-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="llm-usage-heading" className="text-lg font-semibold">
              Token dan Biaya per Call Type
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Agregasi penggunaan LLM Gateway per jenis panggilan dan tanggal lokal.
            </p>
          </div>
        </div>

        {usageError ? (
          <div className="mt-4 rounded border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
            Gagal memuat data penggunaan LLM. Silakan muat ulang halaman.
          </div>
        ) : usageList.length === 0 ? (
          <div className="mt-4 rounded border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            Belum ada data penggunaan LLM.
          </div>
        ) : (
          <div className="mt-4">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="py-2.5 font-medium">Tanggal</th>
                    <th className="py-2.5 font-medium">Call Type</th>
                    <th className="py-2.5 font-medium text-right">Panggilan</th>
                    <th className="py-2.5 font-medium text-right">Prompt</th>
                    <th className="py-2.5 font-medium text-right">Completion</th>
                    <th className="py-2.5 font-medium text-right">Estimasi Biaya</th>
                    <th className="py-2.5 font-medium text-right">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {usageList.map((row) => {
                    const hasErrors = row.errors > 0;
                    return (
                      <tr
                        key={`${row.day}-${row.call_type}`}
                        className={`hover:bg-[var(--surface-muted)] ${
                          hasErrors ? "border-l-4 border-l-[var(--danger)] bg-[var(--danger-soft)]/20" : ""
                        }`}
                      >
                        <td className="py-2.5 font-medium">{row.day}</td>
                        <td className="py-2.5 font-mono text-xs">{row.call_type}</td>
                        <td className="py-2.5 text-right font-mono">{row.calls}</td>
                        <td className="py-2.5 text-right font-mono">{row.prompt_tokens.toLocaleString()}</td>
                        <td className="py-2.5 text-right font-mono">{row.completion_tokens.toLocaleString()}</td>
                        <td className="py-2.5 text-right font-mono">{formatUsd(row.cost_usd)}</td>
                        <td className="py-2.5 text-right font-mono">
                          {hasErrors ? (
                            <span className="font-bold text-[var(--danger)]">
                              [!] {row.errors}
                            </span>
                          ) : (
                            "0"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Stack */}
            <div className="md:hidden space-y-3">
              {usageList.map((row) => {
                const hasErrors = row.errors > 0;
                return (
                  <div
                    key={`${row.day}-${row.call_type}`}
                    className={`rounded border p-3 text-sm ${
                      hasErrors
                        ? "border-[var(--danger)] bg-[var(--danger-soft)]/20 border-l-4 border-l-[var(--danger)]"
                        : "border-[var(--line)] bg-[var(--surface)]"
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                      <span className="font-semibold">{row.day}</span>
                      <span className="font-mono text-xs font-medium text-[var(--muted)]">
                        {row.call_type}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-[var(--muted)]">Panggilan</dt>
                        <dd className="font-mono font-medium">{row.calls}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Biaya Estimasi</dt>
                        <dd className="font-mono font-medium">{formatUsd(row.cost_usd)}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Token (P / C)</dt>
                        <dd className="font-mono font-medium">
                          {row.prompt_tokens} / {row.completion_tokens}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Error</dt>
                        <dd className="font-mono font-medium">
                          {hasErrors ? (
                            <span className="font-bold text-[var(--danger)]">
                              [!] {row.errors}
                            </span>
                          ) : (
                            "0"
                          )}
                        </dd>
                      </div>
                    </dl>
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
