# Step 08 — Analytics, E2E, Deployment

## 1. Goal

Menutup MVP dengan observabilitas dan operasional produksi:

- Halaman `/analytics`: completion rate harian, token, dan biaya per `call_type`.
- Halaman `/logs`: `system_events`, riwayat job, dan `message_log`.
- Halaman `/status`: kesehatan DB, WAHA, Google, LLM, heartbeat tick, job terakhir, sinkronisasi tertunda.
- API analitik dan statistik.
- Backup/restore teruji, rotasi retensi, dan smoke test otomatis.
- CI: lint, tipe, unit test, validasi JSON workflow, build image.
- Dokumentasi deployment WSL2, Cloudflare Tunnel, dan runbook.

## 2. Prerequisites

- Step 07 selesai: `tick` dan workflow scheduler berjalan.
- Seluruh container inti sehat.

## 3. File yang Dibuat / Dimodifikasi

```text
dashboard/src/
├── app/
│   ├── (app)/
│   │   ├── analytics/page.tsx
│   │   ├── logs/page.tsx
│   │   ├── status/page.tsx
│   │   └── layout.tsx                  # tambah tautan navigasi
│   └── api/
│       ├── stats/route.ts
│       └── usage/route.ts
├── scripts/
│   ├── smoke.sh
│   ├── backup.sh
│   ├── restore.sh
│   └── validate-workflows.sh
├── .github/workflows/ci.yml
├── docs/
│   └── RUNBOOK.md
└── README.md
```

## 4. Dashboard Analytics dan Observabilitas

### 4.1 `app/api/stats/route.ts`

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: Request) {
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days') ?? 30), 1), 365);

  const rows = await prisma.dailyStat.findMany({
    orderBy: { local_date: 'desc' },
    take: days,
  });

  const stats = rows.map((row) => ({
    local_date: row.local_date.toISOString().slice(0, 10),
    target_count: row.target_count,
    done_count: row.done_count,
    pending_count: row.pending_count,
    completion_rate: row.completion_rate ? Number(row.completion_rate) : null,
    tier: row.tier,
    rolled_over_count: row.rolled_over_count,
  }));

  const withRate = stats.filter((row) => row.completion_rate !== null);
  const average_rate =
    withRate.length > 0
      ? withRate.reduce((sum, row) => sum + (row.completion_rate ?? 0), 0) / withRate.length
      : null;

  return NextResponse.json({
    ok: true,
    days,
    stats,
    summary: {
      total_target: stats.reduce((sum, row) => sum + row.target_count, 0),
      total_done: stats.reduce((sum, row) => sum + row.done_count, 0),
      average_rate,
    },
  });
}
```

### 4.2 `app/api/usage/route.ts`

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

type UsageRow = {
  day: Date;
  call_type: string;
  calls: bigint;
  prompt_tokens: bigint;
  completion_tokens: bigint;
  cost_usd: string;
  errors: bigint;
};

export async function GET(request: Request) {
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days') ?? 30), 1), 365);

  const rows = await prisma.$queryRaw<UsageRow[]>`
    SELECT
      date_trunc('day', ts)::date AS day,
      call_type,
      COUNT(*)::bigint AS calls,
      COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
      COALESCE(SUM(cost_usd), 0)::text AS cost_usd,
      COUNT(*) FILTER (WHERE success = false)::bigint AS errors
    FROM llm_usage_logs
    WHERE ts >= now() - (${days}::int * interval '1 day')
    GROUP BY 1, 2
    ORDER BY 1 DESC, 2 ASC
  `;

  const usage = rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    call_type: row.call_type,
    calls: Number(row.calls),
    prompt_tokens: Number(row.prompt_tokens),
    completion_tokens: Number(row.completion_tokens),
    cost_usd: Number(row.cost_usd),
    errors: Number(row.errors),
  }));

  return NextResponse.json({
    ok: true,
    days,
    usage,
    totals: usage.reduce(
      (total, row) => ({
        calls: total.calls + row.calls,
        prompt_tokens: total.prompt_tokens + row.prompt_tokens,
        completion_tokens: total.completion_tokens + row.completion_tokens,
        cost_usd: total.cost_usd + row.cost_usd,
        errors: total.errors + row.errors,
      }),
      { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, errors: 0 },
    ),
  });
}
```

### 4.3 `app/(app)/analytics/page.tsx`

```tsx
import { prisma } from '@/lib/db';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

type UsageRow = {
  day: string;
  call_type: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  errors: number;
};

async function loadUsage(days: number): Promise<UsageRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      day: Date;
      call_type: string;
      calls: bigint;
      prompt_tokens: bigint;
      completion_tokens: bigint;
      cost_usd: string;
      errors: bigint;
    }>
  >`
    SELECT date_trunc('day', ts)::date AS day, call_type,
           COUNT(*)::bigint AS calls,
           COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
           COALESCE(SUM(cost_usd), 0)::text AS cost_usd,
           COUNT(*) FILTER (WHERE success = false)::bigint AS errors
    FROM llm_usage_logs
    WHERE ts >= now() - (${days}::int * interval '1 day')
    GROUP BY 1, 2
    ORDER BY 1 DESC, 2 ASC
  `;
  return rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    call_type: row.call_type,
    calls: Number(row.calls),
    prompt_tokens: Number(row.prompt_tokens),
    completion_tokens: Number(row.completion_tokens),
    cost_usd: Number(row.cost_usd),
    errors: Number(row.errors),
  }));
}

export default async function AnalyticsPage() {
  const [stats, usage] = await Promise.all([
    prisma.dailyStat.findMany({ orderBy: { local_date: 'desc' }, take: 30 }),
    loadUsage(30),
  ]);

  const totalDone = stats.reduce((sum, row) => sum + row.done_count, 0);
  const totalTarget = stats.reduce((sum, row) => sum + row.target_count, 0);
  const withRate = stats.filter((row) => row.completion_rate !== null);
  const averageRate =
    withRate.length > 0
      ? withRate.reduce((sum, row) => sum + Number(row.completion_rate), 0) / withRate.length
      : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Analitik</h1>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded border bg-white p-4">
          <p className="text-xs text-gray-500">Tugas selesai (30 hari)</p>
          <p className="text-2xl font-semibold">{totalDone}/{totalTarget}</p>
        </div>
        <div className="rounded border bg-white p-4">
          <p className="text-xs text-gray-500">Completion rate rata-rata</p>
          <p className="text-2xl font-semibold">
            {averageRate === null ? '—' : `${Math.round(averageRate)}%`}
          </p>
        </div>
        <div className="rounded border bg-white p-4">
          <p className="text-xs text-gray-500">Biaya LLM (30 hari)</p>
          <p className="text-2xl font-semibold">
            {money.format(usage.reduce((sum, row) => sum + row.cost_usd, 0))}
          </p>
        </div>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">Completion Rate Harian</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Tanggal</th>
              <th>Target</th>
              <th>Selesai</th>
              <th>Rate</th>
              <th>Tier</th>
              <th>Rollover</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => (
              <tr key={row.local_date.toISOString()} className="border-b">
                <td className="py-1">{row.local_date.toISOString().slice(0, 10)}</td>
                <td>{row.target_count}</td>
                <td>{row.done_count}</td>
                <td>{row.completion_rate ? `${Number(row.completion_rate).toFixed(1)}%` : '—'}</td>
                <td>{row.tier}</td>
                <td>{row.rolled_over_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">Token dan Biaya per Call Type</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Tanggal</th>
              <th>Call type</th>
              <th>Call</th>
              <th>Prompt</th>
              <th>Completion</th>
              <th>Biaya</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => (
              <tr key={`${row.day}-${row.call_type}`} className="border-b">
                <td className="py-1">{row.day}</td>
                <td>{row.call_type}</td>
                <td>{row.calls}</td>
                <td>{row.prompt_tokens}</td>
                <td>{row.completion_tokens}</td>
                <td>{money.format(row.cost_usd)}</td>
                <td>{row.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

### 4.4 `app/(app)/status/page.tsx`

```tsx
import { prisma } from '@/lib/db';
import { getSessionStatus } from '@/lib/waha/client';
import { getGoogleRow } from '@/lib/google/oauth';

async function dbHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export default async function StatusPage() {
  const [dbOk, waha, google, llm, lastTick, lastJobs, pendingSync] = await Promise.all([
    dbHealthy(),
    getSessionStatus(),
    getGoogleRow(),
    prisma.llmConfig.findFirst({ where: { is_active: true } }),
    prisma.systemEvent.findFirst({
      where: { source: 'SCHEDULER', code: 'TICK_OK' },
      orderBy: { ts: 'desc' },
    }),
    prisma.dailyExecutionLog.findMany({ orderBy: { claimed_at: 'desc' }, take: 10 }),
    prisma.todo.count({ where: { google_sync_status: { in: ['PENDING', 'FAILED'] } } }),
  ]);

  const tickAgeMinutes = lastTick ? (Date.now() - lastTick.ts.getTime()) / 60_000 : null;
  const tickStale = tickAgeMinutes === null || tickAgeMinutes > 30;

  const items = [
    { label: 'Database', value: dbOk ? 'OK' : 'GAGAL', ok: dbOk },
    { label: 'WAHA', value: waha.status, ok: waha.status === 'WORKING' },
    {
      label: 'Google',
      value: google?.status ?? 'DISCONNECTED',
      ok: google?.status === 'CONNECTED',
    },
    {
      label: 'LLM aktif',
      value: llm ? `${llm.provider} · ${llm.model}` : 'belum ada',
      ok: Boolean(llm),
    },
    {
      label: 'Tick terakhir',
      value: lastTick ? `${lastTick.ts.toISOString()} (${Math.round(tickAgeMinutes ?? 0)} menit lalu)` : 'belum pernah',
      ok: !tickStale,
    },
    {
      label: 'Sinkronisasi tertunda',
      value: String(pendingSync),
      ok: pendingSync === 0,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Status</h1>

      {tickStale ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Peringatan: tick terakhir lebih dari 30 menit atau belum pernah berjalan. Periksa container n8n.
        </p>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded border bg-white p-4">
            <p className="text-xs text-gray-500">{item.label}</p>
            <p className={`font-semibold ${item.ok ? 'text-green-700' : 'text-red-700'}`}>
              {item.value}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">10 Job Terakhir</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Tanggal</th>
              <th>Jenis</th>
              <th>Seq</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {lastJobs.map((job) => (
              <tr key={job.id} className="border-b">
                <td className="py-1">{job.local_date.toISOString().slice(0, 10)}</td>
                <td>{job.job_type}</td>
                <td>{job.seq}</td>
                <td>{job.status}</td>
                <td>{job.attempts}</td>
                <td className="max-w-xs truncate">{job.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

### 4.5 `app/(app)/logs/page.tsx`

```tsx
import { prisma } from '@/lib/db';

export default async function LogsPage() {
  const [events, jobs, messages] = await Promise.all([
    prisma.systemEvent.findMany({ orderBy: { ts: 'desc' }, take: 100 }),
    prisma.dailyExecutionLog.findMany({ orderBy: { claimed_at: 'desc' }, take: 50 }),
    prisma.messageLog.findMany({ orderBy: { created_at: 'desc' }, take: 50 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Log</h1>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">System Events</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Waktu</th>
              <th>Level</th>
              <th>Source</th>
              <th>Code</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b">
                <td className="py-1">{event.ts.toISOString()}</td>
                <td>{event.level}</td>
                <td>{event.source}</td>
                <td>{event.code}</td>
                <td>{event.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">Riwayat Job</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Tanggal</th>
              <th>Jenis</th>
              <th>Seq</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Claimed</th>
              <th>Sent</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b">
                <td className="py-1">{job.local_date.toISOString().slice(0, 10)}</td>
                <td>{job.job_type}</td>
                <td>{job.seq}</td>
                <td>{job.status}</td>
                <td>{job.attempts}</td>
                <td>{job.claimed_at.toISOString()}</td>
                <td>{job.sent_at?.toISOString() ?? ''}</td>
                <td className="max-w-xs truncate">{job.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">Message Log</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Waktu</th>
              <th>Arah</th>
              <th>Chat</th>
              <th>Isi</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id} className="border-b">
                <td className="py-1">{message.created_at.toISOString()}</td>
                <td>{message.direction}</td>
                <td>{message.chat_id}</td>
                <td className="max-w-xl truncate">{message.body ?? message.transcript ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

### 4.6 Navigasi

Tambahkan tautan pada `app/(app)/layout.tsx`:

```tsx
<Link href="/analytics">Analitik</Link>
<Link href="/logs">Log</Link>
<Link href="/status">Status</Link>
```

## 5. Operasional

### 5.1 `scripts/backup.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups

docker compose exec -T botseri-db \
  pg_dump -U "${POSTGRES_USER:-botseri}" -d "${POSTGRES_DB:-botseri}" -Fc \
  > "backups/botseri-${STAMP}.dump"

docker run --rm --volumes-from botseri-waha \
  -v "$PWD/backups":/backup alpine \
  tar czf "/backup/waha-${STAMP}.tar.gz" -C /app/.sessions .

# Simpan 7 salinan terakhir.
ls -1t backups/botseri-*.dump 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t backups/waha-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "backup selesai: backups/botseri-${STAMP}.dump dan backups/waha-${STAMP}.tar.gz"
```

Jadwalkan dari host (contoh cron harian 02:00):

```cron
0 2 * * * cd /home/botseri/botseri && ./scripts/backup.sh >> ./backups/backup.log 2>&1
```

> Simpan `.env` (khususnya `ENCRYPTION_KEY`) terpisah dari direktori backup. Tanpa kunci itu, kolom `*_enc` tidak dapat dipulihkan.

### 5.2 `scripts/restore.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DUMP="${1:-}"
if [ -z "${DUMP}" ] || [ ! -f "${DUMP}" ]; then
  echo "usage: scripts/restore.sh backups/botseri-YYYYMMDD-HHMMSS.dump" >&2
  exit 1
fi

echo "menghentikan dashboard dan n8n"
docker compose stop botseri-dashboard botseri-n8n

echo "memulihkan database dari ${DUMP}"
docker compose exec -T botseri-db \
  pg_restore -U "${POSTGRES_USER:-botseri}" -d "${POSTGRES_DB:-botseri}" \
  --clean --if-exists --no-owner < "${DUMP}"

echo "menjalankan ulang layanan"
docker compose start botseri-dashboard botseri-n8n

echo "restore selesai; verifikasi /status dan jalankan scripts/smoke.sh"
```

### 5.3 `scripts/validate-workflows.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

fail=0
for file in n8n-engine/workflows/*.json; do
  if ! jq empty "${file}"; then
    echo "JSON tidak valid: ${file}" >&2
    fail=1
    continue
  fi

  if jq -e '.nodes[] | select(.type == "n8n-nodes-base.postgres")' "${file}" >/dev/null; then
    echo "Node database dilarang: ${file}" >&2
    fail=1
  fi

  if grep -E -n '(sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,})' "${file}"; then
    echo "Rahasia terdeteksi: ${file}" >&2
    fail=1
  fi

  node -e '
    const fs = require("node:fs");
    const workflow = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!workflow.id || !workflow.name) throw new Error("id/name workflow wajib");
    for (const node of workflow.nodes) {
      if (!node.id || !node.name || !node.type) throw new Error(`node tidak lengkap: ${node.name}`);
    }
  ' "${file}"
done

exit "${fail}"
```

### 5.4 `scripts/smoke.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BASE="${BASE_URL:-http://127.0.0.1:3000}"
TOKEN="${INTERNAL_API_TOKEN:?INTERNAL_API_TOKEN wajib}"

echo "1. health"
curl -fsS "${BASE}/api/internal/health" | jq -e '.status == "ok" and .db == true' >/dev/null

echo "2. internal auth menolak tanpa token"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/internal/tools/get-prioritized-todos" \
  -H 'Content-Type: application/json' -d '{}')"
[ "${code}" = "401" ]

echo "3. tool daftar tugas"
curl -fsS -X POST "${BASE}/api/internal/tools/get-prioritized-todos" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"scope":"TODAY","limit":5}' | jq -e '.ok == true' >/dev/null

echo "4. workflow bersih dari node database dan rahasia"
./scripts/validate-workflows.sh

echo "5. n8n tidak memiliki DATABASE_URL"
if docker compose exec -T botseri-n8n sh -c 'env | grep -q "^DATABASE_URL="'; then
  echo "n8n memiliki DATABASE_URL (dilarang)" >&2
  exit 1
fi

echo "6. migrasi dan data"
docker compose exec -T botseri-db psql -U "${POSTGRES_USER:-botseri}" -d "${POSTGRES_DB:-botseri}" \
  -tAc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" | grep -qE '^[1-9][0-9]*$'

echo "7. status WAHA"
docker compose exec -T botseri-dashboard wget -qO- \
  --header="X-Api-Key: ${WAHA_API_KEY}" \
  "http://botseri-waha:3000/api/sessions/${WAHA_SESSION:-default}" | jq -e '.status' >/dev/null

echo "smoke test lulus"
```

> `smoke.sh` sengaja tidak memanggil `tick` agar tidak mengirim pesan proaktif. Uji `tick` dilakukan manual sesuai Step 07.

### 5.5 Rotasi retensi data

Tambahkan perintah pemeliharaan pada `docs/RUNBOOK.md` dan jalankan bulanan:

```sql
-- Retensi message_log 90 hari (OQ-03)
DELETE FROM message_log WHERE created_at < now() - interval '90 days';
-- system_events 180 hari
DELETE FROM system_events WHERE ts < now() - interval '180 days';
```

## 6. CI

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: dashboard/package-lock.json

      - name: Install
        working-directory: dashboard
        run: npm ci

      - name: Prisma validate
        working-directory: dashboard
        env:
          DATABASE_URL: postgresql://botseri:botseri@localhost:5432/botseri
        run: npx prisma validate

      - name: Lint
        working-directory: dashboard
        run: npm run lint

      - name: Unit tests
        working-directory: dashboard
        run: npm test -- --run

      - name: Build
        working-directory: dashboard
        env:
          DATABASE_URL: postgresql://botseri:botseri@localhost:5432/botseri
          SESSION_SECRET: ci-session-secret-ci-session-secret
          INTERNAL_API_TOKEN: ci-internal-token-ci-internal-token
          ENCRYPTION_KEY: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
          PUBLIC_BASE_URL: https://panel.example.com
          WAHA_API_KEY: ci-waha-key-ci-waha-key
        run: npm run build

      - name: Validate n8n workflows
        run: ./scripts/validate-workflows.sh

  images:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4

      - name: Build dashboard image
        run: docker build -t botseri-dashboard:ci ./dashboard

      - name: Build n8n image
        run: docker build --build-arg N8N_VERSION=1.64.1 -t botseri-n8n:ci ./n8n-engine
```

> Jika `npm run lint` belum ada di `package.json`, tambahkan `"lint": "next lint"`. `validate-workflows.sh` membutuhkan `jq` dan Node (tersedia di runner).

## 7. Deployment

### 7.1 Cloudflare Tunnel

Compose memakai token (`cloudflared tunnel run`), sehingga ingress dikelola di Zero Trust dashboard. Aturan yang wajib dibuat:

```text
1. hostname panel.domain.com, path ^/api/internal(/.*)?$ -> http_status:404
2. hostname panel.domain.com -> http://botseri-dashboard:3000
3. catch-all -> http_status:404
```

Verifikasi dari internet:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://panel.domain.com/api/internal/health
# harus 404
```

Middleware dashboard juga menolak `/api/internal/*` yang membawa `CF-Connecting-IP` atau `CF-Ray`, sebagai lapisan kedua.

### 7.2 WSL2

Ikuti `ARCHITECTURE.md` §18.2:

- Proyek dan volume di filesystem ext4 WSL2, bukan `/mnt/c`.
- Nonaktifkan sleep/hibernasi Windows.
- Sinkronkan jam WSL2 saat boot; `tick` bergantung pada jam host.
- Batasi memori lewat `.wslconfig`.
- Gunakan `restart: unless-stopped` (sudah ada) dan Task Scheduler untuk menyalakan distro + Docker saat boot.

### 7.3 Urutan rilis

```bash
git pull
docker compose pull
docker compose up -d --build
docker compose ps
./scripts/smoke.sh
```

Migrasi Prisma berjalan otomatis lewat entrypoint dashboard. Entrypoint n8n mengimpor ulang workflow jika hash berubah.

## 8. Runbook dan README

Buat `docs/RUNBOOK.md` minimal memuat:

- Perintah `docker compose ps/logs`, lokasi log, dan cara memeriksa `/status`.
- WAHA `SCAN_QR_CODE` / `FAILED`: mulai ulang sesi, pindai QR, cek volume `botseri_wahadata`.
- Google `NEEDS_REAUTH`: hubungkan ulang dari `/integrations`; jelaskan masa berlaku refresh token aplikasi Testing.
- Job `FAILED`: cek `daily_execution_logs`, `system_events`, jendela waktu, dan status WAHA; job dicoba ulang maksimal 3 kali.
- Google sync `FAILED`: cek `google_sync_error`, retry otomatis hingga 8 kali, lalu perbaiki OAuth.
- Restore: hentikan dashboard/n8n, jalankan `scripts/restore.sh`, verifikasi `/status`, jalankan smoke test.
- Rotasi kunci: `scripts/rotate-encryption.ts` (Step 02) + perbarui `.env` dan redeploy.
- Retensi: SQL pembersihan 90/180 hari.

Buat `README.md` ringkas: prasyarat, `cp .env.example .env`, `scripts/gen-secrets.sh`, `docker compose up -d`, buka `/setup`, tautan ke dokumen kanonik, dan perintah verifikasi.

## 9. Definition of Done

```bash
./scripts/validate-workflows.sh
./scripts/smoke.sh
docker compose ps
```

Verifikasi halaman:

1. `/analytics` menampilkan minimal satu baris setelah `daily_stats` dan `llm_usage_logs` terisi; biaya sama dengan `SUM(cost_usd)`.
2. `/logs` menampilkan event, job, dan pesan terbaru.
3. `/status` hijau untuk DB, WAHA `WORKING`, LLM aktif, tick < 30 menit.
4. Matikan sementara `botseri-n8n` > 30 menit → `/status` menampilkan peringatan tick.
5. Jalankan `scripts/backup.sh`, lalu restore ke stack uji:
   ```bash
   ./scripts/backup.sh
   ./scripts/restore.sh backups/botseri-<stamp>.dump
   ./scripts/smoke.sh
   ```
   Jumlah baris `todos` dan `compiled_prompt` sama sebelum/sesudah.
6. `curl https://panel.domain.com/api/internal/health` dari internet → 404.
7. CI hijau pada push.

Kriteria lulus:

- Analytics, Logs, dan Status dapat diakses admin dan menampilkan data nyata.
- Backup menghasilkan dump + arsip sesi WAHA; restore mengembalikan data dan aplikasi sehat.
- Smoke test lulus tanpa mengirim pesan proaktif.
- Workflow JSON bersih dari node database dan rahasia.
- Dokumentasi instalasi, runbook, dan restore tersedia.
