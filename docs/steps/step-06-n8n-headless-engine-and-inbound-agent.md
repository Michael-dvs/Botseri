# Step 06 — n8n Headless Engine & Inbound Agent

## 1. Goal

Menghubungkan WhatsApp → dashboard → LLM → tool → Google → balasan WhatsApp, dengan n8n sebagai **engine tanpa UI**:

- Image n8n kustom dengan provisioning otomatis (kredensial + workflow).
- Workflow `botseri-inbound-agent.json`: filter webhook, dedup/pairing, STT, AI Agent 4 tool, kirim balasan, log outbound.
- Empat endpoint tool di dashboard, lengkap dengan validasi zod, idempotensi, fuzzy match, dan `syncTodo()`.
- `lib/todos`: urutan standar, dedupe key, fuzzy match, planned date.

Setelah step ini, pesan teks atau voice note dari owner menghasilkan to-do/order dan balasan WhatsApp tanpa satu pun node database di n8n.

## 2. Prerequisites

- Step 05 selesai: LLM aktif, WAHA `WORKING`, owner sudah pairing, Google (opsional) terhubung.
- `n8n-engine/` berisi `Dockerfile` dan `.dockerignore` dari Step 01.

## 3. File yang Dibuat / Dimodifikasi

```text
n8n-engine/
├── Dockerfile
├── entrypoint.sh
├── credentials.template.json
└── workflows/
    └── botseri-inbound-agent.json

dashboard/src/
├── lib/todos/index.ts
├── lib/todos/create.ts
└── app/api/internal/
    ├── tools/create-todo-and-order/route.ts
    ├── tools/get-prioritized-todos/route.ts
    ├── tools/update-todo-status/route.ts
    ├── tools/update-todo/route.ts
    └── google-token/route.ts
```

## 4. Dashboard: Tool Layer

### 4.1 `lib/todos/index.ts`

```ts
import crypto from 'node:crypto';

export const ACTIVE_STATUSES = ['PENDING', 'IN_PROGRESS'] as const;

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildDedupeKey(
  sourceMessageId: string | null,
  title: string,
  dueAt: Date | null,
): string | null {
  if (!sourceMessageId) return null;
  return crypto
    .createHash('sha1')
    .update(`${sourceMessageId}|${title.toLowerCase().trim()}|${dueAt?.toISOString() ?? ''}`)
    .digest('hex');
}

type Candidate = { id: string; title: string };

export type FuzzyResult = {
  matches: Array<{ id: string; title: string; score: number }>;
  ambiguous: boolean;
};

export function fuzzyMatch(text: string, candidates: Candidate[]): FuzzyResult {
  const query = normalizeText(text);
  const tokens = query.split(' ').filter((token) => token.length > 1);

  const matches = candidates
    .map((candidate) => {
      const title = normalizeText(candidate.title);
      let score = 0;
      if (title.includes(query)) score += 3;
      for (const token of tokens) {
        if (title.includes(token)) score += 1;
      }
      return { ...candidate, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const ambiguous =
    matches.length > 1 && matches[0].score === matches[1].score && matches[0].score > 0;

  return { matches, ambiguous };
}
```

### 4.2 `lib/todos/create.ts`

```ts
import { Prisma, type BotSettings, type PriorityLevel } from '@prisma/client';
import { prisma } from '@/lib/db';
import { buildDedupeKey } from '@/lib/todos';
import { fromZonedTime } from 'date-fns-tz';
import { localDateString } from '@/lib/time';

export type ToolTodoInput = {
  title: string;
  description?: string | null;
  category?: string | null;
  priority_rank: number;
  due_at?: string | null;
  has_specific_time: boolean;
};

export type ToolOrderInput = {
  customer_name: string;
  customer_contact?: string | null;
  description: string;
  event_date?: string | null;
  delivery_date?: string | null;
  delivery_address?: string | null;
  total_amount?: number | null;
  dp_amount?: number | null;
  payment_status?: 'UNPAID' | 'DP_PAID' | 'PAID';
};

export function resolvePriority(
  rank: number,
  levels: PriorityLevel[],
): { level: PriorityLevel; warning: string | null } {
  const exact = levels.find((level) => level.rank === rank);
  if (exact) return { level: exact, warning: null };
  if (levels.length === 0) throw new Error('Priority Stack kosong');
  const lowest = [...levels].sort((a, b) => b.rank - a.rank)[0];
  return {
    level: lowest,
    warning: `priority_rank ${rank} tidak valid; dipakai rank ${lowest.rank} (${lowest.label})`,
  };
}

export function resolveDueAt(
  input: ToolTodoInput,
  settings: BotSettings,
): { dueAt: Date | null; plannedDate: Date; hasSpecificTime: boolean } {
  if (!input.due_at) {
    const today = localDateString(new Date(), settings.timezone);
    return {
      dueAt: null,
      plannedDate: new Date(`${today}T00:00:00Z`),
      hasSpecificTime: false,
    };
  }

  const parsed = new Date(input.due_at);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`due_at tidak valid: ${input.due_at}`);
  }

  const hasSpecificTime = input.has_specific_time;
  const localDate = localDateString(parsed, settings.timezone);
  const dueAt = hasSpecificTime
    ? parsed
    : fromZonedTime(`${localDate}T${settings.default_due_time}:00`, settings.timezone);

  return {
    dueAt,
    plannedDate: new Date(`${localDate}T00:00:00Z`),
    hasSpecificTime,
  };
}

export async function createOrderForMessage(
  input: ToolOrderInput,
  sourceMessageId: string,
): Promise<string> {
  const marker = `botseri_source:${sourceMessageId}`;
  const existing = await prisma.order.findFirst({ where: { notes: marker } });
  if (existing) return existing.id;

  const order = await prisma.order.create({
    data: {
      customer_name: input.customer_name,
      customer_contact: input.customer_contact ?? null,
      description: input.description,
      event_date: input.event_date ? new Date(input.event_date) : null,
      delivery_date: input.delivery_date ? new Date(input.delivery_date) : null,
      delivery_address: input.delivery_address ?? null,
      total_amount: input.total_amount ?? null,
      dp_amount: input.dp_amount ?? null,
      payment_status: input.payment_status ?? 'UNPAID',
      notes: marker,
    },
  });
  return order.id;
}

export async function createTodoIdempotent(params: {
  input: ToolTodoInput;
  settings: BotSettings;
  levels: PriorityLevel[];
  sourceMessageId: string;
  orderId: string | null;
}): Promise<{ todo: Awaited<ReturnType<typeof prisma.todo.create>>; deduplicated: boolean; warning: string | null }> {
  const { input, settings, levels, sourceMessageId, orderId } = params;
  const { level, warning } = resolvePriority(input.priority_rank, levels);
  const { dueAt, plannedDate, hasSpecificTime } = resolveDueAt(input, settings);
  const dedupeKey = buildDedupeKey(sourceMessageId, input.title, dueAt);

  if (dedupeKey) {
    const existing = await prisma.todo.findUnique({ where: { dedupe_key: dedupeKey } });
    if (existing) return { todo: existing, deduplicated: true, warning };
  }

  try {
    const todo = await prisma.todo.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        priority_level_id: level.id,
        priority_rank: level.rank,
        due_at: dueAt,
        has_specific_time: hasSpecificTime,
        planned_date: plannedDate,
        order_id: orderId,
        source_message_id: sourceMessageId,
        dedupe_key: dedupeKey,
        created_via: 'CHAT',
      },
    });
    return { todo, deduplicated: false, warning };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      dedupeKey
    ) {
      const existing = await prisma.todo.findUniqueOrThrow({ where: { dedupe_key: dedupeKey } });
      return { todo: existing, deduplicated: true, warning };
    }
    throw error;
  }
}
```

### 4.3 `app/api/internal/tools/create-todo-and-order/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { checkInternalAuth } from '@/lib/internal/auth';
import { localIsoString } from '@/lib/time';
import { createOrderForMessage, createTodoIdempotent } from '@/lib/todos/create';

const iso = z.string().datetime({ offset: true });

const orderSchema = z.object({
  customer_name: z.string().min(1).max(150),
  customer_contact: z.string().max(50).nullable().optional(),
  description: z.string().min(1).max(5000),
  event_date: iso.nullable().optional(),
  delivery_date: iso.nullable().optional(),
  delivery_address: z.string().max(2000).nullable().optional(),
  total_amount: z.number().nonnegative().nullable().optional(),
  dp_amount: z.number().nonnegative().nullable().optional(),
  payment_status: z.enum(['UNPAID', 'DP_PAID', 'PAID']).optional(),
});

const todoSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(40).nullable().optional(),
  priority_rank: z.number().int().min(1),
  due_at: iso.nullable().optional(),
  has_specific_time: z.boolean(),
});

const schema = z.object({
  source_message_id: z.string().uuid(),
  order: orderSchema.nullable().optional(),
  todos: z.array(todoSchema).min(1).max(10),
});

export async function POST(request: Request) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const [settings, levels, message] = await Promise.all([
    prisma.botSettings.findUnique({ where: { id: 1 } }),
    prisma.priorityLevel.findMany({ orderBy: { rank: 'asc' } }),
    prisma.messageLog.findUnique({ where: { id: input.source_message_id } }),
  ]);
  if (!settings || levels.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'FAILED', message: 'pengaturan atau Priority Stack belum siap' } },
      { status: 200 },
    );
  }
  if (!message) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'source_message_id tidak ditemukan' } },
      { status: 200 },
    );
  }

  const orderId = input.order
    ? await createOrderForMessage(input.order, input.source_message_id)
    : null;

  const warnings: string[] = [];
  const created = [];

  for (const todoInput of input.todos) {
    const result = await createTodoIdempotent({
      input: todoInput,
      settings,
      levels,
      sourceMessageId: input.source_message_id,
      orderId,
    });
    if (result.warning) warnings.push(result.warning);
    created.push({ ...result.todo, deduplicated: result.deduplicated });
  }

  // Sinkronisasi setelah semua baris tersimpan; kegagalan Google tidak membatalkan to-do.
  const { syncTodo } = await import('@/lib/google/sync');
  for (const todo of created) {
    if (!todo.deduplicated) await syncTodo(todo.id);
  }

  const refreshed = await prisma.todo.findMany({
    where: { id: { in: created.map((todo) => todo.id) } },
    include: { priority_level: true },
  });
  const byId = new Map(refreshed.map((todo) => [todo.id, todo]));

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    todos: created.map((item) => {
      const todo = byId.get(item.id) ?? item;
      return {
        id: todo.id,
        title: todo.title,
        priority_rank: todo.priority_rank,
        priority_label: 'priority_level' in todo ? todo.priority_level?.label ?? null : null,
        due_at: todo.due_at ? localIsoString(todo.due_at, settings.timezone) : null,
        planned_date: todo.planned_date.toISOString().slice(0, 10),
        google_sync_status: todo.google_sync_status,
        deduplicated: item.deduplicated,
      };
    }),
    warnings,
  });
}
```

> Catatan: `created` memakai tipe gabungan `Prisma Todo` dan hasil `include`; TypeScript dapat menyempitkan dengan `'priority_level' in todo`. Jika compiler mengeluh, deklarasikan `created: Array<Awaited<ReturnType<typeof createTodoIdempotent>>['todo'] & { deduplicated: boolean }>`.

### 4.4 `app/api/internal/tools/get-prioritized-todos/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { checkInternalAuth } from '@/lib/internal/auth';
import { localDateString, localIsoString } from '@/lib/time';

const schema = z.object({
  scope: z.enum(['TODAY', 'ALL_ACTIVE', 'OVERDUE']).default('TODAY'),
  limit: z.number().int().min(1).max(100).default(30),
});

type Row = {
  id: string;
  title: string;
  priority_rank: number;
  priority_label: string | null;
  due_at: Date | null;
  planned_date: Date;
  status: string;
  rollover_count: number;
};

export async function POST(request: Request) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { scope, limit } = parsed.data;
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = localDateString(new Date(), settings.timezone);

  const scopeSql =
    scope === 'TODAY'
      ? Prisma.sql`AND planned_date <= ${today}::date`
      : scope === 'OVERDUE'
        ? Prisma.sql`AND planned_date < ${today}::date`
        : Prisma.empty;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, title, priority_rank, priority_label, due_at, planned_date, status, rollover_count
    FROM v_active_todos
    WHERE true ${scopeSql}
    ORDER BY priority_rank ASC, due_at ASC NULLS LAST, created_at ASC
    LIMIT ${limit}
  `;

  const upcoming = await prisma.$queryRaw<Row[]>`
    SELECT id, title, priority_rank, priority_label, due_at, planned_date, status, rollover_count
    FROM v_active_todos
    WHERE planned_date > ${today}::date
    ORDER BY priority_rank ASC, due_at ASC NULLS LAST, created_at ASC
    LIMIT ${limit}
  `;

  const mapRow = (row: Row) => ({
    id: row.id,
    title: row.title,
    priority_rank: row.priority_rank,
    priority_label: row.priority_label,
    due_at: row.due_at ? localIsoString(row.due_at, settings.timezone) : null,
    planned_date: row.planned_date.toISOString().slice(0, 10),
    status: row.status,
    hanging: row.rollover_count >= 3,
  });

  const mapped = rows.map(mapRow);
  const focusRows = scope === 'TODAY' ? mapped.slice(0, 3) : [];
  const restRows = scope === 'TODAY' ? mapped.slice(3) : mapped;
  const activeCount = await prisma.todo.count({
    where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
  });

  return NextResponse.json({
    ok: true,
    focus: focusRows,
    rest: restRows,
    upcoming: upcoming.map(mapRow),
    counts: {
      focus: focusRows.length,
      rest: restRows.length,
      upcoming: upcoming.length,
      total_active: activeCount,
    },
  });
}
```

> `ALL_ACTIVE` mengembalikan seluruh hasil pada `rest`; `OVERDUE` juga mengembalikan hasil lewat tanggal pada `rest`. `focus` hanya diisi untuk `TODAY`.

### 4.5 `app/api/internal/tools/update-todo-status/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { checkInternalAuth } from '@/lib/internal/auth';
import { fuzzyMatch } from '@/lib/todos';
import { syncTodo } from '@/lib/google/sync';
import { localIsoString } from '@/lib/time';

const schema = z
  .object({
    todo_id: z.string().uuid().optional(),
    match_text: z.string().min(1).max(200).optional(),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']),
  })
  .refine((value) => Boolean(value.todo_id || value.match_text), {
    message: 'todo_id atau match_text wajib',
  });

function domainError(code: string, message: string, candidates?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, candidates } });
}

export async function POST(request: Request) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  let todoId = input.todo_id ?? null;

  if (!todoId && input.match_text) {
    const active = await prisma.todo.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
      select: { id: true, title: true },
      take: 100,
    });
    const result = fuzzyMatch(input.match_text, active);
    if (result.matches.length === 0) {
      return domainError('NOT_FOUND', 'Tidak ada tugas aktif yang cocok.');
    }
    if (result.ambiguous) {
      return domainError(
        'AMBIGUOUS',
        'Ditemukan lebih dari 1 tugas serupa. Tolong tanyakan konfirmasi ke pengguna.',
        result.matches.slice(0, 5).map((item) => ({ id: item.id, title: item.title })),
      );
    }
    todoId = result.matches[0].id;
  }

  const todo = await prisma.todo.findUnique({ where: { id: todoId! } });
  if (!todo) return domainError('NOT_FOUND', 'Tugas tidak ditemukan.');

  const updated = await prisma.todo.update({
    where: { id: todo.id },
    data: {
      status: input.status,
      completed_at: input.status === 'DONE' ? new Date() : null,
    },
  });
  await syncTodo(updated.id);

  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  return NextResponse.json({
    ok: true,
    todo: {
      id: updated.id,
      title: updated.title,
      status: updated.status,
      completed_at: updated.completed_at
        ? localIsoString(updated.completed_at, settings.timezone)
        : null,
    },
  });
}
```

### 4.6 `app/api/internal/tools/update-todo/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { checkInternalAuth } from '@/lib/internal/auth';
import { localDateString, localIsoString } from '@/lib/time';
import { syncTodo } from '@/lib/google/sync';

const schema = z.object({
  todo_id: z.string().uuid(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  has_specific_time: z.boolean().optional(),
  priority_rank: z.number().int().min(1).optional(),
});

export async function POST(request: Request) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const [todo, settings, level, oauth] = await Promise.all([
    prisma.todo.findUnique({ where: { id: input.todo_id } }),
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    input.priority_rank
      ? prisma.priorityLevel.findUnique({ where: { rank: input.priority_rank } })
      : Promise.resolve(null),
    prisma.oAuthToken.findFirst({ where: { provider: 'google' } }),
  ]);

  if (!todo) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'Tugas tidak ditemukan.' } },
      { status: 200 },
    );
  }
  if (input.priority_rank && !level) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_RANK', message: 'priority_rank tidak ada di Priority Stack.' } },
      { status: 200 },
    );
  }

  const dueAt =
    input.due_at === undefined
      ? todo.due_at
      : input.due_at === null
        ? null
        : new Date(input.due_at);

  const plannedDate =
    input.due_at === undefined || dueAt === null
      ? todo.planned_date
      : new Date(`${localDateString(dueAt, settings.timezone)}T00:00:00Z`);

  const updated = await prisma.todo.update({
    where: { id: todo.id },
    data: {
      title: input.title,
      description: input.description,
      due_at: dueAt,
      has_specific_time: input.has_specific_time,
      planned_date: plannedDate,
      priority_rank: level?.rank,
      priority_level_id: level?.id,
      google_sync_status: oauth?.status === 'CONNECTED' ? 'PENDING' : 'NOT_REQUIRED',
    },
  });
  await syncTodo(updated.id);

  return NextResponse.json({
    ok: true,
    todo: {
      id: updated.id,
      title: updated.title,
      due_at: updated.due_at ? localIsoString(updated.due_at, settings.timezone) : null,
      planned_date: updated.planned_date.toISOString().slice(0, 10),
      priority_rank: updated.priority_rank,
      google_sync_status: updated.google_sync_status,
    },
  });
}
```

### 4.7 `app/api/internal/google-token/route.ts`

```ts
import { NextResponse } from 'next/server';
import { checkInternalAuth } from '@/lib/internal/auth';
import { getValidAccessToken } from '@/lib/google/oauth';

export async function GET(request: Request) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const accessToken = await getValidAccessToken();
    return NextResponse.json({ ok: true, access_token: accessToken });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'NEEDS_REAUTH',
          message: error instanceof Error ? error.message : 'Google tidak tersedia',
        },
      },
      { status: 409 },
    );
  }
}
```

## 5. n8n Headless Provisioning

### 5.1 `n8n-engine/Dockerfile`

```dockerfile
ARG N8N_VERSION
FROM n8nio/n8n:${N8N_VERSION}

USER root
RUN apk add --no-cache jq gettext
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER node
ENTRYPOINT ["/entrypoint.sh"]
```

### 5.2 `n8n-engine/credentials.template.json`

```json
[
  {
    "id": "botseriInternalApi",
    "name": "Botseri Internal API",
    "type": "httpHeaderAuth",
    "data": {
      "name": "Authorization",
      "value": "Bearer ${INTERNAL_API_TOKEN}"
    }
  },
  {
    "id": "botseriLlmGateway",
    "name": "Botseri LLM Gateway",
    "type": "openAiApi",
    "data": {
      "apiKey": "${INTERNAL_API_TOKEN}"
    }
  },
  {
    "id": "botseriWaha",
    "name": "Botseri WAHA",
    "type": "httpHeaderAuth",
    "data": {
      "name": "X-Api-Key",
      "value": "${WAHA_API_KEY}"
    }
  }
]
```

### 5.3 `n8n-engine/entrypoint.sh`

```bash
#!/bin/sh
set -eu

DASHBOARD_URL="${DASHBOARD_URL:-http://botseri-dashboard:3000}"
WORKFLOW_DIR="/workflows"
HASH_FILE="${HOME}/.n8n/workflows.hash"
CREDENTIALS_TMP="$(mktemp)"

echo "n8n-entrypoint: menunggu dashboard ${DASHBOARD_URL}/api/internal/health"
i=0
until wget -qO- "${DASHBOARD_URL}/api/internal/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 120 ]; then
    echo "n8n-entrypoint: dashboard tidak sehat setelah 120 percobaan" >&2
    exit 1
  fi
  sleep 5
done
echo "n8n-entrypoint: dashboard sehat"

# Render kredensial. Berkas sementara dihapus apa pun hasilnya.
envsubst < /credentials.template.json > "${CREDENTIALS_TMP}"
if ! n8n import:credentials --input="${CREDENTIALS_TMP}"; then
  rm -f "${CREDENTIALS_TMP}"
  echo "n8n-entrypoint: impor kredensial gagal" >&2
  exit 1
fi
rm -f "${CREDENTIALS_TMP}"

CURRENT_HASH="$(find "${WORKFLOW_DIR}" -type f -name '*.json' -print0 \
  | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
STORED_HASH="$(cat "${HASH_FILE}" 2>/dev/null || true)"

if [ "${CURRENT_HASH}" != "${STORED_HASH}" ]; then
  echo "n8n-entrypoint: workflow berubah, impor ulang"
  if ! n8n import:workflow --separate --input="${WORKFLOW_DIR}"; then
    echo "n8n-entrypoint: impor workflow gagal" >&2
    exit 1
  fi
  if ! n8n update:workflow --all --active=true; then
    echo "n8n-entrypoint: aktivasi workflow gagal" >&2
    exit 1
  fi
  printf '%s' "${CURRENT_HASH}" > "${HASH_FILE}"
else
  echo "n8n-entrypoint: workflow tidak berubah"
fi

exec n8n start
```

> `[VERIFY]` pada versi n8n yang di-pin: opsi `import:credentials`, format `--input` untuk direktori workflow, dan `update:workflow --all --active=true`. Jika `n8n update:workflow` tidak mendukung `--all`, ganti dengan loop ID tetap: `n8n update:workflow --id=botseriInboundAgent01 --active=true`. Catat hasilnya di `docs/VERSIONS.md`.

### 5.4 `n8n-engine/workflows/botseri-inbound-agent.json`

```json
{
  "id": "botseriInboundAgent01",
  "name": "Botseri Inbound Agent",
  "active": true,
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": false
  },
  "nodes": [
    {
      "id": "webhook-incoming",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 300],
      "webhookId": "b07e51a4-1c1f-4e7a-9f0a-4a4f3d1f0001",
      "parameters": {
        "httpMethod": "POST",
        "path": "wa-incoming",
        "responseMode": "onReceived",
        "options": {}
      }
    },
    {
      "id": "filter-event",
      "name": "Filter Event",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [220, 300],
      "parameters": {
        "jsCode": "const input = $json ?? {};\nconst payload = input.payload ?? {};\nconst from = String(payload.from ?? '');\nconst blocked = !from || payload.fromMe === true || from.endsWith('@g.us') || from === 'status@broadcast';\nif (input.event !== 'message' || blocked) return [];\nreturn [{ json: { event: input.event, session: input.session ?? 'default', payload } }];"
      }
    },
    {
      "id": "http-accept",
      "name": "Accept",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [440, 300],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/inbound/accept",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ wa_message_id: $json.payload.id, chat_id: $json.payload.from, body: $json.payload.body || null, has_media: $json.payload.hasMedia === true, media_type: $json.payload.media?.mimetype || null, received_at: new Date(Number($json.payload.timestamp || Date.now() / 1000) * 1000).toISOString() }) }}",
        "options": { "timeout": 15000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "if-accept",
      "name": "Accept?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [660, 300],
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 2 },
          "conditions": [
            {
              "id": "accept-true",
              "leftValue": "={{ $json.accept }}",
              "rightValue": true,
              "operator": { "type": "boolean", "operation": "true", "singleValue": true }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      }
    },
    {
      "id": "if-reply",
      "name": "Ada Balasan?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [880, 440],
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 2 },
          "conditions": [
            {
              "id": "reply-present",
              "leftValue": "={{ $json.reply_text }}",
              "rightValue": "",
              "operator": { "type": "string", "operation": "notEmpty", "singleValue": true }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      }
    },
    {
      "id": "http-send-rejection",
      "name": "Kirim Penolakan",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1100, 520],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/waha/send",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ chat_id: $json.reply_to_chat_id, body: $json.reply_text, trigger_type: 'PAIRING' }) }}",
        "options": { "timeout": 15000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternal", "name": "Botseri Internal" }
      }
    },
    {
      "id": "noop-rejected",
      "name": "Selesai Tanpa Balasan",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [1100, 360]
    },
    {
      "id": "if-audio",
      "name": "Voice Note?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [880, 180],
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 2 },
          "conditions": [
            {
              "id": "audio-true",
              "leftValue": "={{ $('Filter Event').item.json.payload.hasMedia === true && String($('Filter Event').item.json.payload.media?.mimetype || '').startsWith('audio/') }}",
              "rightValue": true,
              "operator": { "type": "boolean", "operation": "true", "singleValue": true }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      }
    },
    {
      "id": "http-download-audio",
      "name": "Unduh Audio",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1100, 80],
      "parameters": {
        "method": "GET",
        "url": "={{ $('Filter Event').item.json.payload.media.url }}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {
          "timeout": 120000,
          "response": {
            "response": {
              "responseFormat": "file",
              "outputPropertyName": "data"
            }
          }
        }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriWaha", "name": "Botseri WAHA" }
      }
    },
    {
      "id": "http-transcribe",
      "name": "Transkripsi",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1320, 80],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/llm/v1/audio/transcriptions",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "contentType": "multipart-form-data",
        "bodyParameters": {
          "parameters": [
            {
              "parameterType": "formBinaryData",
              "name": "file",
              "inputDataFieldName": "data"
            },
            {
              "parameterType": "formData",
              "name": "model",
              "value": "botseri-default"
            }
          ]
        },
        "options": { "timeout": 120000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "http-save-transcript",
      "name": "Simpan Transkrip",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1540, 80],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/inbound/{{ $('Accept').item.json.message_id }}/transcript",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ transcript: $json.text }) }}",
        "options": { "timeout": 15000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "set-transcript-text",
      "name": "Teks Transkrip",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [1760, 80],
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "transcript-text",
              "name": "text",
              "value": "={{ $('Transkripsi').item.json.text }}",
              "type": "string"
            }
          ]
        },
        "options": {}
      }
    },
    {
      "id": "http-context",
      "name": "Context",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1980, 180],
      "parameters": {
        "method": "GET",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/context/chat",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "message_id",
              "value": "={{ $('Accept').item.json.message_id }}"
            }
          ]
        },
        "options": { "timeout": 15000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "build-agent-input",
      "name": "Susun Input Agen",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2200, 180],
      "parameters": {
        "jsCode": "const context = $('Context').item.json;\nconst text = $json.text ?? $('Filter Event').item.json.payload.body ?? '';\nreturn [{ json: { text: String(text).trim(), system_prompt: context.system_prompt } }];"
      }
    },
    {
      "id": "ai-agent",
      "name": "AI Agent",
      "type": "@n8n/n8n-nodes-langchain.agent",
      "typeVersion": 1.7,
      "position": [2420, 180],
      "parameters": {
        "promptType": "define",
        "text": "={{ $json.text }}",
        "options": {
          "systemMessage": "={{ $json.system_prompt }}",
          "maxIterations": 6
        }
      }
    },
    {
      "id": "lm-openai",
      "name": "Botseri Gateway",
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "typeVersion": 1.2,
      "position": [2340, 400],
      "parameters": {
        "model": {
          "__rl": true,
          "value": "botseri-default",
          "mode": "list",
          "cachedResultName": "botseri-default"
        },
        "options": {
          "baseURL": "={{ $env.DASHBOARD_URL }}/api/internal/llm/v1",
          "temperature": 0.3
        }
      },
      "credentials": {
        "openAiApi": { "id": "botseriLlmGateway", "name": "Botseri LLM Gateway" }
      }
    },
    {
      "id": "tool-create",
      "name": "tool_create_todo_and_order",
      "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
      "typeVersion": 1.1,
      "position": [2480, 400],
      "parameters": {
        "toolDescription": "Menyimpan pesanan baru dan/atau to-do operasional ke dalam sistem Botseri.",
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/tools/create-todo-and-order",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ source_message_id: $('Accept').item.json.message_id, order: $fromAI('order', 'Detail pesanan pelanggan atau null', 'json'), todos: $fromAI('todos', 'Daftar 1-10 to-do operasional', 'json') }) }}",
        "options": { "timeout": 20000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "tool-list",
      "name": "tool_get_prioritized_todos",
      "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
      "typeVersion": 1.1,
      "position": [2620, 400],
      "parameters": {
        "toolDescription": "Mengambil daftar to-do yang sudah diurutkan berdasarkan priority_rank dan tenggat waktu.",
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/tools/get-prioritized-todos",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ scope: $fromAI('scope', 'TODAY, ALL_ACTIVE, atau OVERDUE', 'string') || 'TODAY', limit: Number($fromAI('limit', 'Jumlah maksimum item', 'number')) || 30 }) }}",
        "options": { "timeout": 20000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "tool-status",
      "name": "tool_update_todo_status",
      "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
      "typeVersion": 1.1,
      "position": [2760, 400],
      "parameters": {
        "toolDescription": "Memperbarui status tugas to-do (PENDING, IN_PROGRESS, DONE, CANCELLED).",
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/tools/update-todo-status",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ todo_id: $fromAI('todo_id', 'UUID to-do jika diketahui', 'string') || null, match_text: $fromAI('match_text', 'Judul atau kata kunci to-do', 'string') || null, status: $fromAI('status', 'Status baru', 'string') }) }}",
        "options": { "timeout": 20000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "tool-update",
      "name": "tool_update_todo",
      "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
      "typeVersion": 1.1,
      "position": [2900, 400],
      "parameters": {
        "toolDescription": "Memperbarui detail to-do: judul, tenggat, jam spesifik, atau prioritas.",
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/tools/update-todo",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ todo_id: $fromAI('todo_id', 'UUID to-do', 'string'), title: $fromAI('title', 'Judul baru', 'string') || undefined, due_at: $fromAI('due_at', 'ISO 8601 dengan offset', 'string') || undefined, has_specific_time: $fromAI('has_specific_time', 'true jika jam eksplisit', 'boolean'), priority_rank: Number($fromAI('priority_rank', 'Rank prioritas', 'number')) || undefined }) }}",
        "options": { "timeout": 20000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "split-output",
      "name": "Pecah Pesan",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2640, 180],
      "parameters": {
        "jsCode": "const text = String($json.output ?? '').trim();\nif (!text) return [];\nconst parts = [];\nlet buffer = '';\nfor (const paragraph of text.split(/\\n{2,}/)) {\n  const candidate = buffer ? `${buffer}\\n\\n${paragraph}` : paragraph;\n  if (candidate.length <= 3500) { buffer = candidate; continue; }\n  if (buffer) parts.push(buffer);\n  if (paragraph.length <= 3500) { buffer = paragraph; continue; }\n  for (let i = 0; i < paragraph.length; i += 3500) parts.push(paragraph.slice(i, i + 3500));\n  buffer = '';\n}\nif (buffer) parts.push(buffer);\nconst chatId = $('Filter Event').item.json.payload.from;\nreturn parts.map((part) => ({ json: { chat_id: chatId, text: part } }));"
      }
    },
    {
      "id": "http-send",
      "name": "Kirim WhatsApp",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [2860, 180],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/waha/send",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ chat_id: $json.chat_id, body: $json.text, trigger_type: 'CHAT_MASUK', reply_to_wa_message_id: $('Ambil Konteks').item.json.context.recent_messages.slice(-1)[0]?.wa_message_id }) }}",
        "options": { "timeout": 30000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternal", "name": "Botseri Internal" }
      }
    },
    {
      "id": "http-outbound-log",
      "name": "Log Outbound",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [3080, 180],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.DASHBOARD_URL }}/api/internal/outbound/log",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ chat_id: $('Pecah Pesan').item.json.chat_id, body: $('Pecah Pesan').item.json.text, in_reply_to: $('Accept').item.json.message_id }) }}",
        "options": { "timeout": 15000 }
      },
      "credentials": {
        "httpHeaderAuth": { "id": "botseriInternalApi", "name": "Botseri Internal API" }
      }
    },
    {
      "id": "noop-done",
      "name": "Selesai",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [3300, 180]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [[{ "node": "Filter Event", "type": "main", "index": 0 }]]
    },
    "Filter Event": {
      "main": [[{ "node": "Accept", "type": "main", "index": 0 }]]
    },
    "Accept": {
      "main": [[{ "node": "Accept?", "type": "main", "index": 0 }]]
    },
    "Accept?": {
      "main": [
        [{ "node": "Voice Note?", "type": "main", "index": 0 }],
        [{ "node": "Ada Balasan?", "type": "main", "index": 0 }]
      ]
    },
    "Ada Balasan?": {
      "main": [
        [{ "node": "Kirim Penolakan", "type": "main", "index": 0 }],
        [{ "node": "Selesai Tanpa Balasan", "type": "main", "index": 0 }]
      ]
    },
    "Voice Note?": {
      "main": [
        [{ "node": "Unduh Audio", "type": "main", "index": 0 }],
        [{ "node": "Context", "type": "main", "index": 0 }]
      ]
    },
    "Unduh Audio": {
      "main": [[{ "node": "Transkripsi", "type": "main", "index": 0 }]]
    },
    "Transkripsi": {
      "main": [[{ "node": "Simpan Transkrip", "type": "main", "index": 0 }]]
    },
    "Simpan Transkrip": {
      "main": [[{ "node": "Teks Transkrip", "type": "main", "index": 0 }]]
    },
    "Teks Transkrip": {
      "main": [[{ "node": "Context", "type": "main", "index": 0 }]]
    },
    "Context": {
      "main": [[{ "node": "Susun Input Agen", "type": "main", "index": 0 }]]
    },
    "Susun Input Agen": {
      "main": [[{ "node": "AI Agent", "type": "main", "index": 0 }]]
    },
    "AI Agent": {
      "main": [[{ "node": "Pecah Pesan", "type": "main", "index": 0 }]],
      "ai_languageModel": [
        [{ "node": "Botseri Gateway", "type": "ai_languageModel", "index": 0 }]
      ],
      "ai_tool": [
        [
          { "node": "tool_create_todo_and_order", "type": "ai_tool", "index": 0 },
          { "node": "tool_get_prioritized_todos", "type": "ai_tool", "index": 0 },
          { "node": "tool_update_todo_status", "type": "ai_tool", "index": 0 },
          { "node": "tool_update_todo", "type": "ai_tool", "index": 0 }
        ]
      ]
    },
    "Pecah Pesan": {
      "main": [[{ "node": "Kirim WhatsApp", "type": "main", "index": 0 }]]
    },
    "Kirim WhatsApp": {
      "main": [[{ "node": "Log Outbound", "type": "main", "index": 0 }]]
    },
    "Log Outbound": {
      "main": [[{ "node": "Selesai", "type": "main", "index": 0 }]]
    }
  }
}
```

> `[VERIFY]` pada versi n8n: `typeVersion` node Agent/OpenAI/Tool, nama opsi `baseURL`, `maxIterations`, dan dukungan `$fromAI()` pada `toolHttpRequest`. Semua node tanpa kredensial rahasia; rahasia hanya dirender ke kredensial oleh entrypoint.

### 5.5 Catatan implementasi agent

1. **Riwayat chat** sudah dirender ke `system_prompt` oleh `GET /context/chat` (`recent_messages`), sehingga node agent tidak memakai memory store terpisah. Ini mencegah kebocoran antar-chat dan tetap memenuhi §8.8.
2. **Batas iterasi** 6 sesuai §9.2.
3. **Pemecahan pesan** dilakukan sebelum kirim: paragraf digabung sampai 3500 karakter.
4. **Error workflow** belum ditambahkan pada step ini karena payload Error Trigger n8n tidak memuat `chat_id` owner. Ditangani pada Step 08 bersama halaman Status. Ini dicatat sebagai deviasi `[OPEN]` dan tidak mengubah kontrak Internal API.
5. `WAHA` harus mengirim webhook ke `http://botseri-n8n:5678/webhook/wa-incoming`; nilai ini sudah diatur di Compose Step 01.

## 6. Definition of Done

```bash
cd dashboard && npm run build
cd .. && docker compose build botseri-n8n && docker compose up -d
docker compose logs -f botseri-n8n
```

Log harus memuat:

```text
n8n-entrypoint: dashboard sehat
n8n-entrypoint: workflow berubah, impor ulang
```

Verifikasi endpoint tanpa WhatsApp:

```bash
TOKEN=$(grep '^INTERNAL_API_TOKEN=' .env | cut -d= -f2-)
curl -sS -X POST http://127.0.0.1:3000/api/internal/tools/get-prioritized-todos \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"scope":"TODAY","limit":10}' | jq
```

Harapan: `{ "ok": true, "focus": [...], ... }` dan tidak ada error koneksi DB dari n8n.

Verifikasi end-to-end:

1. Dari nomor owner, kirim: `besok jam 10 antar buket Bu Ani ke Pondok Indah`.
2. Dalam ±15 detik, balasan WhatsApp masuk.
3. `todos` bertambah dengan judul relevan, `priority_rank` valid, `planned_date` = besok.
4. Jika Google terhubung, `google_sync_status = SYNCED` dan event Calendar muncul.
5. `message_log` memuat INBOUND dan OUTBOUND; `llm_usage_logs` bertambah.
6. Kirim pesan yang sama dari webhook (replay `wa_message_id`): `inbound/accept` mengembalikan `DUPLICATE`; jumlah to-do tidak bertambah.
7. Kirim voice note: transkrip tersimpan di `message_log.transcript` dan balasan dihasilkan dari teksnya. Jika mesin WAHA tidak mendukung unduhan media, pesan dibalas "belum didukung" (batasan §13.3, `[VERIFY]`).
8. Kirim `PAIR-XXXXXX` dari nomor baru: nomor masuk `authorized_numbers`, balasan konfirmasi terkirim, pesan berikutnya dilayani.
9. Kirim dari nomor tak terdaftar: tidak ada balasan; `system_events` mencatat `UNAUTHORIZED_SENDER`.
10. Cek isolasi: `docker exec botseri-n8n env | grep DATABASE_URL` tidak menghasilkan apa pun.

Kriteria lulus:

- `npm run build` sukses.
- Workflow aktif otomatis tanpa membuka UI n8n.
- Empat tool mengembalikan `ok:true` atau `ok:false` domain (bukan 500).
- Replay pesan tidak menduplikasi to-do/order.
- n8n tidak memiliki `DATABASE_URL` dan tidak ada rahasia di JSON workflow.
- Voice note menghasilkan transkrip atau balasan "belum didukung" yang jelas.
