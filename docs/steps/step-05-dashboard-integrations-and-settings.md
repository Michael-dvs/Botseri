# Step 05 — Settings, LLM Manager, WAHA, dan Google Integration

## 1. Goal

Melengkapi dashboard dengan seluruh konfigurasi runtime yang dibutuhkan sistem:

- Halaman pengaturan: profil bisnis, jam kerja, jam brief, zona waktu, hari kerja, hari libur, mode perilaku, reminder, dan mode sinkronisasi Google.
- Multi-LLM API Manager: simpan API key terenkripsi AES-256-GCM, aktivasi satu konfigurasi, dan uji koneksi.
- Integrasi WhatsApp: status sesi, QR, mulai/hentikan sesi, dan pembuatan kode pairing `PAIR-XXXXXX`.
- Integrasi Google: simpan OAuth client, alur OAuth2, refresh token otomatis, dan `syncTodo()` ke Calendar + Tasks.

Setelah step ini, n8n memiliki semua prasyarat data untuk menjalankan agen pada Step 06.

## 2. Prerequisites

- Step 04 selesai: UI CRUD, Priority Stack, dan prompt editor berjalan.
- Google Cloud project dengan Calendar API dan Tasks API aktif.
- Akses ke WAHA melalui jaringan Docker (`http://botseri-waha:3000`).

## 3. File yang Dibuat / Dimodifikasi

```text
docker-compose.yml                                  # dashboard: tambah WAHA_URL
dashboard/src/
├── app/
│   ├── (app)/
│   │   ├── settings/page.tsx
│   │   ├── settings/SettingsForm.tsx
│   │   ├── integrations/page.tsx
│   │   └── integrations/IntegrationsPanel.tsx
│   └── api/
│       ├── settings/route.ts
│       ├── holidays/route.ts
│       ├── llm/configs/route.ts
│       ├── llm/configs/[id]/route.ts
│       ├── llm/test/route.ts
│       ├── waha/status/route.ts
│       ├── waha/qr/route.ts
│       ├── waha/session/route.ts
│       ├── waha/pairing-code/route.ts
│       ├── oauth/google/credentials/route.ts
│       ├── oauth/google/start/route.ts
│       ├── oauth/google/callback/route.ts
│       └── google/disconnect/route.ts
├── lib/
│   ├── waha/client.ts
│   └── google/
│       ├── oauth.ts
│       ├── client.ts
│       ├── calendar.ts
│       ├── tasks.ts
│       └── sync.ts
└── (modifikasi) app/api/todos/route.ts dan [id]/route.ts
```

## 4. Langkah Implementasi

### 4.1 Compose: dashboard membutuhkan URL WAHA

Tambahkan pada `environment` service `botseri-dashboard` di `docker-compose.yml`:

```yaml
      WAHA_URL: http://botseri-waha:3000
```

`WAHA_API_KEY` dan `WAHA_SESSION` sudah tersedia melalui `env_file: .env`.

### 4.2 `app/api/settings/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { compileSystemPrompt } from '@/lib/prompt/compiler';

const time = z.string().regex(/^\d{2}:\d{2}$/);

const schema = z.object({
  brand_name: z.string().min(1).max(100),
  business_type: z.string().min(1).max(100),
  owner_name: z.string().min(1).max(100),
  timezone: z.string().min(1).max(50),
  work_hours_start: time,
  work_hours_end: time,
  early_brief_time: time,
  working_days: z.array(z.number().int().min(1).max(7)).min(1),
  behavior_mode: z.enum(['STRICT', 'SANTAI']),
  behavior_instruction: z.string().max(4000).nullable(),
  reminder_interval_minutes: z.number().int().min(0).max(1440),
  reminder_max_per_day: z.number().int().min(0).max(24),
  reminder_max_rank: z.number().int().min(1).max(99),
  brief_window_minutes: z.number().int().min(5).max(720),
  eod_window_minutes: z.number().int().min(5).max(720),
  default_due_time: time,
  google_sync_mode: z.enum(['AUTO', 'BOTH']),
  bot_enabled: z.boolean(),
});

export async function GET() {
  const [settings, holidays] = await Promise.all([
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.holiday.findMany({ orderBy: { date: 'asc' } }),
  ]);
  return NextResponse.json({
    ok: true,
    settings,
    holidays: holidays.map((holiday) => ({
      date: holiday.date.toISOString().slice(0, 10),
      label: holiday.label,
    })),
  });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const settings = await prisma.botSettings.update({
    where: { id: 1 },
    data: parsed.data,
  });
  const levels = await prisma.priorityLevel.findMany({ orderBy: { rank: 'asc' } });
  const compiled = compileSystemPrompt(settings, levels);

  await prisma.botSettings.update({
    where: { id: 1 },
    data: {
      compiled_prompt: compiled.prompt,
      compiled_prompt_version: compiled.version,
      compiled_at: new Date(),
    },
  });

  return NextResponse.json({ ok: true, warnings: compiled.warnings });
}
```

### 4.3 `app/api/holidays/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1).max(100),
});

export async function GET() {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  return NextResponse.json({
    ok: true,
    holidays: holidays.map((holiday) => ({
      date: holiday.date.toISOString().slice(0, 10),
      label: holiday.label,
    })),
  });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const holiday = await prisma.holiday.upsert({
    where: { date: new Date(`${parsed.data.date}T00:00:00Z`) },
    update: { label: parsed.data.label },
    create: { date: new Date(`${parsed.data.date}T00:00:00Z`), label: parsed.data.label },
  });
  return NextResponse.json({ ok: true, holiday });
}

export async function DELETE(request: Request) {
  const date = new URL(request.url).searchParams.get('date');
  if (!date) return NextResponse.json({ ok: false, error: 'date wajib' }, { status: 400 });
  await prisma.holiday.deleteMany({ where: { date: new Date(`${date}T00:00:00Z`) } });
  return NextResponse.json({ ok: true });
}
```

### 4.4 `app/(app)/settings/page.tsx` dan `SettingsForm.tsx`

`page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const [settings, holidays] = await Promise.all([
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.holiday.findMany({ orderBy: { date: 'asc' } }),
  ]);

  return (
    <SettingsForm
      initial={JSON.parse(JSON.stringify(settings))}
      initialHolidays={holidays.map((holiday) => ({
        date: holiday.date.toISOString().slice(0, 10),
        label: holiday.label,
      }))}
    />
  );
}
```

`SettingsForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Settings = {
  brand_name: string;
  business_type: string;
  owner_name: string;
  timezone: string;
  work_hours_start: string;
  work_hours_end: string;
  early_brief_time: string;
  working_days: number[];
  behavior_mode: 'STRICT' | 'SANTAI';
  behavior_instruction: string | null;
  reminder_interval_minutes: number;
  reminder_max_per_day: number;
  reminder_max_rank: number;
  brief_window_minutes: number;
  eod_window_minutes: number;
  default_due_time: string;
  google_sync_mode: 'AUTO' | 'BOTH';
  bot_enabled: boolean;
};

const dayLabels = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export function SettingsForm({
  initial,
  initialHolidays,
}: {
  initial: Settings;
  initialHolidays: Array<{ date: string; label: string }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [message, setMessage] = useState('');

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleDay(day: number) {
    set(
      'working_days',
      form.working_days.includes(day)
        ? form.working_days.filter((item) => item !== day)
        : [...form.working_days, day].sort((a, b) => a - b),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, behavior_instruction: form.behavior_instruction || null }),
    });
    const payload = await response.json();
    setMessage(response.ok ? 'Pengaturan tersimpan dan prompt dikompilasi.' : payload.error?.toString() ?? 'Gagal menyimpan.');
    if (response.ok) router.refresh();
  }

  async function addHoliday(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: data.get('date'), label: data.get('label') }),
    });
    if (!response.ok) {
      setMessage('Gagal menambah hari libur.');
      return;
    }
    setHolidays((current) => [...current, { date: String(data.get('date')), label: String(data.get('label')) }]);
    event.currentTarget.reset();
    router.refresh();
  }

  async function removeHoliday(date: string) {
    const response = await fetch(`/api/holidays?date=${date}`, { method: 'DELETE' });
    if (!response.ok) {
      setMessage('Gagal menghapus hari libur.');
      return;
    }
    setHolidays((current) => current.filter((holiday) => holiday.date !== date));
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Pengaturan</h1>
      {message ? <p className="text-sm text-blue-700">{message}</p> : null}

      <section className="grid gap-3 rounded border bg-white p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">Nama brand
          <input value={form.brand_name} onChange={(e) => set('brand_name', e.target.value)} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Jenis usaha
          <input value={form.business_type} onChange={(e) => set('business_type', e.target.value)} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Nama owner
          <input value={form.owner_name} onChange={(e) => set('owner_name', e.target.value)} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Zona waktu
          <input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} className="rounded border p-2" />
        </label>
      </section>

      <section className="grid gap-3 rounded border bg-white p-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">Jam kerja mulai
          <input type="time" value={form.work_hours_start} onChange={(e) => set('work_hours_start', e.target.value)} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Jam kerja selesai
          <input type="time" value={form.work_hours_end} onChange={(e) => set('work_hours_end', e.target.value)} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Jam Morning Brief
          <input type="time" value={form.early_brief_time} onChange={(e) => set('early_brief_time', e.target.value)} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Tenggat default
          <input type="time" value={form.default_due_time} onChange={(e) => set('default_due_time', e.target.value)} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Interval reminder (menit)
          <input type="number" min={0} value={form.reminder_interval_minutes} onChange={(e) => set('reminder_interval_minutes', Number(e.target.value))} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Maks reminder/hari
          <input type="number" min={0} value={form.reminder_max_per_day} onChange={(e) => set('reminder_max_per_day', Number(e.target.value))} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Reminder maks rank
          <input type="number" min={1} value={form.reminder_max_rank} onChange={(e) => set('reminder_max_rank', Number(e.target.value))} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Jendela brief (menit)
          <input type="number" min={5} value={form.brief_window_minutes} onChange={(e) => set('brief_window_minutes', Number(e.target.value))} className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Jendela EOD (menit)
          <input type="number" min={5} value={form.eod_window_minutes} onChange={(e) => set('eod_window_minutes', Number(e.target.value))} className="rounded border p-2" />
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded border bg-white p-4">
        <p className="text-sm font-medium">Hari kerja</p>
        <div className="flex flex-wrap gap-2">
          {dayLabels.map((label, index) => {
            const day = index + 1;
            return (
              <label key={label} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
                <input type="checkbox" checked={form.working_days.includes(day)} onChange={() => toggleDay(day)} />
                {label}
              </label>
            );
          })}
        </div>

        <p className="text-sm font-medium">Hari libur</p>
        <div className="flex flex-wrap gap-2">
          {holidays.map((holiday) => (
            <span key={holiday.date} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
              {holiday.date} · {holiday.label}
              <button type="button" onClick={() => removeHoliday(holiday.date)} className="text-red-600">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input name="date" type="date" form="holiday-form" className="rounded border p-2" />
          <input name="label" placeholder="Keterangan" form="holiday-form" className="rounded border p-2" />
          <button type="submit" form="holiday-form" className="rounded border px-3 py-2 text-sm">Tambah</button>
        </div>
        <form id="holiday-form" onSubmit={addHoliday} />
      </section>

      <section className="grid gap-3 rounded border bg-white p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">Mode perilaku
          <select value={form.behavior_mode} onChange={(e) => set('behavior_mode', e.target.value as 'STRICT' | 'SANTAI')} className="rounded border p-2">
            <option value="STRICT">STRICT</option>
            <option value="SANTAI">SANTAI</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Mode sinkronisasi Google
          <select value={form.google_sync_mode} onChange={(e) => set('google_sync_mode', e.target.value as 'AUTO' | 'BOTH')} className="rounded border p-2">
            <option value="AUTO">AUTO (Calendar jika jam spesifik, selain itu Tasks)</option>
            <option value="BOTH">BOTH</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">Instruksi perilaku
          <textarea value={form.behavior_instruction ?? ''} onChange={(e) => set('behavior_instruction', e.target.value)} rows={3} className="rounded border p-2" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.bot_enabled} onChange={(e) => set('bot_enabled', e.target.checked)} />
          Bot aktif
        </label>
      </section>

      <button type="submit" className="self-start rounded bg-black px-4 py-2 text-white">Simpan</button>
    </form>
  );
}
```

### 4.5 LLM Manager

`app/api/llm/configs/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';

const schema = z.object({
  provider: z.enum(['OPENAI', 'OPENROUTER', 'GEMINI', 'CUSTOM_OPENAI_COMPAT', 'ANTHROPIC']),
  model: z.string().min(1).max(100),
  base_url: z.string().url().nullable().optional(),
  api_key: z.string().min(8).max(4096),
  stt_model: z.string().max(100).nullable().optional(),
  temperature: z.number().min(0).max(2).default(0.3),
  max_output_tokens: z.number().int().min(1).max(8000).default(1000),
  price_input_per_mtok: z.number().nonnegative().nullable().optional(),
  price_output_per_mtok: z.number().nonnegative().nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function GET() {
  const configs = await prisma.llmConfig.findMany({ orderBy: { is_active: 'desc' } });
  return NextResponse.json({
    ok: true,
    configs: configs.map((config) => ({
      id: config.id,
      provider: config.provider,
      model: config.model,
      base_url: config.base_url,
      stt_model: config.stt_model,
      temperature: config.temperature,
      max_output_tokens: config.max_output_tokens,
      price_input_per_mtok: config.price_input_per_mtok ? Number(config.price_input_per_mtok) : null,
      price_output_per_mtok: config.price_output_per_mtok ? Number(config.price_output_per_mtok) : null,
      is_active: config.is_active,
      has_api_key: config.api_key_enc.length > 0,
    })),
  });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const config = await prisma.$transaction(async (tx) => {
    if (input.is_active) {
      await tx.llmConfig.updateMany({ data: { is_active: false } });
    }
    return tx.llmConfig.create({
      data: {
        provider: input.provider,
        model: input.model,
        base_url: input.base_url ?? null,
        api_key_enc: encryptSecret(input.api_key, 'llm_configs.api_key_enc'),
        stt_model: input.stt_model ?? null,
        temperature: input.temperature,
        max_output_tokens: input.max_output_tokens,
        price_input_per_mtok: input.price_input_per_mtok ?? null,
        price_output_per_mtok: input.price_output_per_mtok ?? null,
        is_active: input.is_active,
      },
    });
  });

  return NextResponse.json({ ok: true, id: config.id });
}
```

`app/api/llm/configs/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';

const schema = z.object({
  provider: z.enum(['OPENAI', 'OPENROUTER', 'GEMINI', 'CUSTOM_OPENAI_COMPAT', 'ANTHROPIC']).optional(),
  model: z.string().min(1).max(100).optional(),
  base_url: z.string().url().nullable().optional(),
  api_key: z.string().min(8).max(4096).optional(),
  stt_model: z.string().max(100).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().min(1).max(8000).optional(),
  price_input_per_mtok: z.number().nonnegative().nullable().optional(),
  price_output_per_mtok: z.number().nonnegative().nullable().optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  await prisma.$transaction(async (tx) => {
    if (input.is_active) {
      await tx.llmConfig.updateMany({ data: { is_active: false } });
    }
    await tx.llmConfig.update({
      where: { id: params.id },
      data: {
        provider: input.provider,
        model: input.model,
        base_url: input.base_url,
        api_key_enc: input.api_key
          ? encryptSecret(input.api_key, 'llm_configs.api_key_enc')
          : undefined,
        stt_model: input.stt_model,
        temperature: input.temperature,
        max_output_tokens: input.max_output_tokens,
        price_input_per_mtok: input.price_input_per_mtok,
        price_output_per_mtok: input.price_output_per_mtok,
        is_active: input.is_active,
      },
    });
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  await prisma.llmConfig.deleteMany({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
```

`app/api/llm/test/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { callOpenAiCompatible } from '@/lib/llm-gateway/openai-compatible';
import { callAnthropic } from '@/lib/llm-gateway/anthropic';

const schema = z.object({ config_id: z.string().uuid().optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'payload tidak valid' }, { status: 400 });
  }

  const config = parsed.data.config_id
    ? await prisma.llmConfig.findUnique({ where: { id: parsed.data.config_id } })
    : await prisma.llmConfig.findFirst({ where: { is_active: true } });
  if (!config) {
    return NextResponse.json({ ok: false, error: 'konfigurasi LLM tidak ditemukan' }, { status: 404 });
  }

  const apiKey = decryptSecret(config.api_key_enc, 'llm_configs.api_key_enc');
  const payload = {
    messages: [{ role: 'user', content: 'Balas satu kata: ok' }],
    max_tokens: 8,
    temperature: 0,
  };

  const startedAt = Date.now();
  try {
    const response =
      config.provider === 'ANTHROPIC'
        ? await callAnthropic(config, apiKey, payload)
        : await callOpenAiCompatible(config, apiKey, payload);
    const body = await response.json();
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      sample: response.ok ? body : undefined,
      error: response.ok ? null : body,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
```

### 4.6 WAHA client dan endpoint

`lib/waha/client.ts`:

```ts
const baseUrl = () => (process.env.WAHA_URL ?? 'http://botseri-waha:3000').replace(/\/$/, '');
const apiKey = () => process.env.WAHA_API_KEY ?? '';
const session = () => process.env.WAHA_SESSION ?? 'default';

export async function wahaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'X-Api-Key': apiKey(),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

export async function getSessionStatus(): Promise<{ status: string; raw?: unknown }> {
  try {
    const response = await wahaFetch(`/api/sessions/${encodeURIComponent(session())}`);
    if (!response.ok) return { status: 'UNKNOWN' };
    const raw = await response.json();
    const status = typeof raw === 'object' && raw && 'status' in raw ? String(raw.status) : 'UNKNOWN';
    return { status, raw };
  } catch {
    return { status: 'UNREACHABLE' };
  }
}

export async function getQrImage(): Promise<Response> {
  return wahaFetch(`/api/${encodeURIComponent(session())}/auth/qr`, {
    headers: { Accept: 'image/png' },
  });
}

export async function startSession(): Promise<Response> {
  return wahaFetch('/api/sessions/start', {
    method: 'POST',
    body: JSON.stringify({ name: session() }),
  });
}

export async function stopSession(): Promise<Response> {
  return wahaFetch(`/api/sessions/${encodeURIComponent(session())}/stop`, { method: 'POST' });
}

export const wahaSessionName = session;
```

`app/api/waha/status/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSessionStatus, wahaSessionName } from '@/lib/waha/client';

export async function GET() {
  const status = await getSessionStatus();
  return NextResponse.json({ ok: true, session: wahaSessionName(), ...status });
}
```

`app/api/waha/qr/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getQrImage } from '@/lib/waha/client';

export async function GET() {
  const upstream = await getQrImage();
  if (!upstream.ok) {
    return NextResponse.json({ ok: false, error: 'QR tidak tersedia' }, { status: upstream.status });
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
```

`app/api/waha/session/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startSession, stopSession } from '@/lib/waha/client';

const schema = z.object({ action: z.enum(['start', 'stop']) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'payload tidak valid' }, { status: 400 });
  }
  const upstream = parsed.data.action === 'start' ? await startSession() : await stopSession();
  const body = await upstream.json().catch(() => ({}));
  return NextResponse.json({ ok: upstream.ok, upstream: body }, { status: upstream.ok ? 200 : upstream.status });
}
```

`app/api/waha/pairing-code/route.ts`:

```ts
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return `PAIR-${suffix}`;
}

export async function POST() {
  await prisma.pairingCode.deleteMany({ where: { used_at: null, expires_at: { lt: new Date() } } });

  const code = generateCode();
  await prisma.pairingCode.create({
    data: {
      code_hash: crypto.createHash('sha256').update(code).digest('hex'),
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return NextResponse.json({ ok: true, code, expires_in_minutes: 10 });
}
```

### 4.7 Google OAuth

`lib/google/oauth.ts`:

```ts
import { prisma } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/crypto';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
];

export function redirectUri(): string {
  return `${process.env.PUBLIC_BASE_URL}/api/oauth/google/callback`;
}

export async function saveClientCredentials(clientId: string, clientSecret: string) {
  const existing = await prisma.oAuthToken.findFirst({ where: { provider: 'google' } });
  const data = {
    client_id: clientId,
    client_secret_enc: encryptSecret(clientSecret, 'oauth_tokens.client_secret_enc'),
    scopes: GOOGLE_SCOPES,
  };
  if (existing) {
    return prisma.oAuthToken.update({ where: { id: existing.id }, data });
  }
  return prisma.oAuthToken.create({
    data: { provider: 'google', status: 'DISCONNECTED', ...data },
  });
}

export async function getGoogleRow() {
  return prisma.oAuthToken.findFirst({ where: { provider: 'google' } });
}

export async function exchangeCode(code: string) {
  const row = await getGoogleRow();
  if (!row?.client_id || !row.client_secret_enc) {
    throw new Error('kredensial OAuth Google belum disimpan');
  }
  const clientSecret = decryptSecret(row.client_secret_enc, 'oauth_tokens.client_secret_enc');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: row.client_id,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`penukaran kode gagal: ${JSON.stringify(tokens).slice(0, 500)}`);
  }

  let email: string | null = null;
  if (tokens.access_token) {
    const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profile.ok) {
      const data = await profile.json();
      email = typeof data.email === 'string' ? data.email : null;
    }
  }

  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

  await prisma.oAuthToken.update({
    where: { id: row.id },
    data: {
      account_email: email,
      access_token_enc: tokens.access_token
        ? encryptSecret(tokens.access_token, 'oauth_tokens.access_token_enc')
        : row.access_token_enc,
      refresh_token_enc: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token, 'oauth_tokens.refresh_token_enc')
        : row.refresh_token_enc,
      expires_at: expiresAt,
      status: 'CONNECTED',
    },
  });
}

export async function getValidAccessToken(): Promise<string> {
  const row = await getGoogleRow();
  if (!row || row.status !== 'CONNECTED') {
    throw new Error('Google belum terhubung');
  }
  if (!row.access_token_enc) {
    throw new Error('access token tidak tersedia');
  }
  if (row.expires_at && row.expires_at.getTime() > Date.now() + 60_000) {
    return decryptSecret(row.access_token_enc, 'oauth_tokens.access_token_enc');
  }

  if (!row.refresh_token_enc || !row.client_id || !row.client_secret_enc) {
    await prisma.oAuthToken.update({ where: { id: row.id }, data: { status: 'NEEDS_REAUTH' } });
    throw new Error('refresh token tidak tersedia; hubungkan ulang Google');
  }

  const clientSecret = decryptSecret(row.client_secret_enc, 'oauth_tokens.client_secret_enc');
  const refreshToken = decryptSecret(row.refresh_token_enc, 'oauth_tokens.refresh_token_enc');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: row.client_id,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();

  if (!response.ok) {
    if (data.error === 'invalid_grant') {
      await prisma.oAuthToken.update({ where: { id: row.id }, data: { status: 'NEEDS_REAUTH' } });
    }
    throw new Error(`refresh gagal: ${data.error ?? response.status}`);
  }

  const accessToken = data.access_token as string;
  await prisma.oAuthToken.update({
    where: { id: row.id },
    data: {
      access_token_enc: encryptSecret(accessToken, 'oauth_tokens.access_token_enc'),
      expires_at: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
    },
  });
  return accessToken;
}
```

`app/api/oauth/google/credentials/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getGoogleRow, saveClientCredentials } from '@/lib/google/oauth';

const schema = z.object({
  client_id: z.string().min(10).max(255),
  client_secret: z.string().min(10).max(255),
});

export async function GET() {
  const row = await getGoogleRow();
  return NextResponse.json({
    ok: true,
    client_id: row?.client_id ?? null,
    has_secret: Boolean(row?.client_secret_enc),
    status: row?.status ?? 'DISCONNECTED',
    account_email: row?.account_email ?? null,
  });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  await saveClientCredentials(parsed.data.client_id, parsed.data.client_secret);
  return NextResponse.json({ ok: true });
}
```

`app/api/oauth/google/start/route.ts`:

```ts
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { GOOGLE_SCOPES, getGoogleRow, redirectUri } from '@/lib/google/oauth';

export async function GET() {
  const row = await getGoogleRow();
  if (!row?.client_id || !row.client_secret_enc) {
    return NextResponse.json({ error: 'simpan client_id dan client_secret terlebih dahulu' }, { status: 400 });
  }

  const state = crypto.randomBytes(24).toString('hex');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', row.client_id);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  const response = NextResponse.redirect(url);
  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}
```

`app/api/oauth/google/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCode } from '@/lib/google/oauth';

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const expected = request.cookies.get('google_oauth_state')?.value;

  if (!state || !expected || state !== expected) {
    return NextResponse.redirect(new URL('/integrations?google=state_error', request.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL('/integrations?google=denied', request.url));
  }

  try {
    await exchangeCode(code);
  } catch {
    return NextResponse.redirect(new URL('/integrations?google=error', request.url));
  }

  const response = NextResponse.redirect(new URL('/integrations?google=connected', request.url));
  response.cookies.set('google_oauth_state', '', { path: '/', maxAge: 0 });
  return response;
}
```

`app/api/google/disconnect/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST() {
  const row = await prisma.oAuthToken.findFirst({ where: { provider: 'google' } });
  if (row) {
    await prisma.oAuthToken.update({
      where: { id: row.id },
      data: {
        status: 'DISCONNECTED',
        access_token_enc: null,
        refresh_token_enc: null,
        expires_at: null,
      },
    });
  }
  return NextResponse.json({ ok: true });
}
```

### 4.8 Google client dan sinkronisasi

`lib/google/client.ts`:

```ts
import { google } from 'googleapis';
import { getValidAccessToken } from './oauth';

export async function getGoogleClients() {
  const accessToken = await getValidAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return {
    calendar: google.calendar({ version: 'v3', auth }),
    tasks: google.tasks({ version: 'v1', auth }),
  };
}
```

`lib/google/calendar.ts`:

```ts
import type { calendar_v3 } from 'googleapis';
import { getGoogleClients } from './client';

export type CalendarTodo = {
  id: string;
  title: string;
  description: string | null;
  due_at: Date;
  status: string;
};

function eventId(todoId: string): string {
  return todoId.replace(/-/g, '');
}

function eventBody(todo: CalendarTodo, timeZone: string) {
  const start = todo.due_at;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: eventId(todo.id),
    summary: `${todo.status === 'DONE' ? '[SELESAI] ' : ''}${todo.title}`,
    description: todo.description ?? undefined,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    extendedProperties: { private: { botseri_todo_id: todo.id } },
  } satisfies calendar_v3.Schema$Event;
}

export async function upsertCalendarEvent(
  todo: CalendarTodo,
  calendarId: string,
  timeZone: string,
  hasExisting: boolean,
): Promise<string> {
  const { calendar } = await getGoogleClients();
  const requestBody = eventBody(todo, timeZone);

  if (!hasExisting) {
    try {
      const created = await calendar.events.insert({ calendarId, requestBody });
      return created.data.id ?? eventId(todo.id);
    } catch (error) {
      const status = (error as { code?: number }).code;
      if (status !== 409) throw error;
    }
  }

  const updated = await calendar.events.patch({
    calendarId,
    eventId: eventId(todo.id),
    requestBody,
  });
  return updated.data.id ?? eventId(todo.id);
}

export async function completeCalendarEvent(
  todo: CalendarTodo,
  calendarId: string,
  timeZone: string,
): Promise<void> {
  const { calendar } = await getGoogleClients();
  await calendar.events.patch({
    calendarId,
    eventId: eventId(todo.id),
    requestBody: {
      summary: `[SELESAI] ${todo.title}`,
      start: { dateTime: todo.due_at.toISOString(), timeZone },
      end: { dateTime: new Date(todo.due_at.getTime() + 3600_000).toISOString(), timeZone },
    },
  });
}

export async function deleteCalendarEvent(todoId: string, calendarId: string): Promise<void> {
  const { calendar } = await getGoogleClients();
  try {
    await calendar.events.delete({ calendarId, eventId: eventId(todoId) });
  } catch (error) {
    const status = (error as { code?: number }).code;
    if (status !== 404) throw error;
  }
}
```

`lib/google/tasks.ts`:

```ts
import type { tasks_v1 } from 'googleapis';
import { getGoogleClients } from './client';

const MARKER = 'botseri:';

export type TaskTodo = {
  id: string;
  title: string;
  description: string | null;
  due_at: Date | null;
  planned_date: Date;
  status: string;
  google_task_id: string | null;
};

function dueIso(todo: TaskTodo): string | undefined {
  const date = todo.due_at ?? todo.planned_date;
  return date.toISOString();
}

function notes(todo: TaskTodo): string {
  return `${MARKER}${todo.id}\n${todo.description ?? ''}`.trim();
}

async function findTaskByMarker(
  tasklist: string,
  todoId: string,
): Promise<tasks_v1.Schema$Task | null> {
  const { tasks } = await getGoogleClients();
  const list = await tasks.tasks.list({
    tasklist,
    showCompleted: true,
    showHidden: true,
    maxResults: 100,
  });
  return (
    list.data.items?.find((item) => item.notes?.includes(`${MARKER}${todoId}`)) ?? null
  );
}

export async function upsertGoogleTask(todo: TaskTodo, tasklist: string): Promise<string> {
  const { tasks } = await getGoogleClients();
  const existing = todo.google_task_id
    ? { id: todo.google_task_id }
    : await findTaskByMarker(tasklist, todo.id);

  const body: tasks_v1.Schema$Task = {
    title: todo.title,
    notes: notes(todo),
    due: dueIso(todo),
    status: todo.status === 'DONE' ? 'completed' : 'needsAction',
  };

  if (existing?.id) {
    const updated = await tasks.tasks.patch({
      tasklist,
      task: existing.id,
      requestBody: body,
    });
    return updated.data.id ?? existing.id;
  }

  const created = await tasks.tasks.insert({ tasklist, requestBody: body });
  if (!created.data.id) throw new Error('Google Tasks tidak mengembalikan id');
  return created.data.id;
}

export async function completeGoogleTask(todo: TaskTodo, tasklist: string): Promise<void> {
  if (!todo.google_task_id) return;
  const { tasks } = await getGoogleClients();
  await tasks.tasks.patch({
    tasklist,
    task: todo.google_task_id,
    requestBody: { status: 'completed' },
  });
}

export async function deleteGoogleTask(todoId: string, tasklist: string, knownId: string | null): Promise<void> {
  const { tasks } = await getGoogleClients();
  const targetId = knownId ?? (await findTaskByMarker(tasklist, todoId))?.id ?? null;
  if (!targetId) return;
  try {
    await tasks.tasks.delete({ tasklist, task: targetId });
  } catch (error) {
    const status = (error as { code?: number }).code;
    if (status !== 404) throw error;
  }
}
```

`lib/google/sync.ts`:

```ts
import type { OAuthToken, Todo } from '@prisma/client';
import { prisma } from '@/lib/db';
import { recordEvent } from '@/lib/events';
import {
  completeCalendarEvent,
  deleteCalendarEvent,
  upsertCalendarEvent,
} from './calendar';
import {
  completeGoogleTask,
  deleteGoogleTask,
  upsertGoogleTask,
} from './tasks';

function requiresCalendar(todo: Todo, mode: string): boolean {
  if (mode === 'BOTH') return true;
  return todo.has_specific_time && todo.due_at !== null;
}

function requiresTasks(todo: Todo, mode: string): boolean {
  if (mode === 'BOTH') return true;
  return !(todo.has_specific_time && todo.due_at !== null);
}

export async function syncTodo(todoId: string): Promise<void> {
  const [todo, settings, oauth] = await Promise.all([
    prisma.todo.findUnique({ where: { id: todoId } }),
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.oAuthToken.findFirst({ where: { provider: 'google' } }),
  ]);

  if (!todo) return;
  if (!oauth || oauth.status !== 'CONNECTED') {
    return; // belum terhubung: biarkan NOT_REQUIRED
  }

  const calendarId = oauth.calendar_id ?? 'primary';
  const tasklistId = oauth.tasklist_id ?? '@default';

  try {
    if (todo.status === 'CANCELLED') {
      await deleteCalendarEvent(todo.id, calendarId);
      await deleteGoogleTask(todo.id, tasklistId, todo.google_task_id);
      await prisma.todo.update({
        where: { id: todo.id },
        data: {
          google_sync_status: 'NOT_REQUIRED',
          calendar_event_id: null,
          google_task_id: null,
          google_sync_error: null,
        },
      });
      return;
    }

    let calendarEventId = todo.calendar_event_id;
    let googleTaskId = todo.google_task_id;

    if (requiresCalendar(todo, settings.google_sync_mode)) {
      if (!todo.due_at) {
        throw new Error('event Calendar membutuhkan due_at');
      }
      if (todo.status === 'DONE' && todo.calendar_event_id) {
        await completeCalendarEvent(
          { id: todo.id, title: todo.title, description: todo.description, due_at: todo.due_at, status: todo.status },
          calendarId,
          settings.timezone,
        );
        calendarEventId = todo.calendar_event_id;
      } else {
        calendarEventId = await upsertCalendarEvent(
          { id: todo.id, title: todo.title, description: todo.description, due_at: todo.due_at, status: todo.status },
          calendarId,
          settings.timezone,
          Boolean(todo.calendar_event_id),
        );
      }
    }

    if (requiresTasks(todo, settings.google_sync_mode)) {
      if (todo.status === 'DONE' && todo.google_task_id) {
        await completeGoogleTask(todo, tasklistId);
        googleTaskId = todo.google_task_id;
      } else {
        googleTaskId = await upsertGoogleTask(todo, tasklistId);
      }
    }

    await prisma.todo.update({
      where: { id: todo.id },
      data: {
        calendar_event_id: calendarEventId,
        google_task_id: googleTaskId,
        google_sync_status: 'SYNCED',
        google_sync_error: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    await prisma.todo.update({
      where: { id: todo.id },
      data: {
        google_sync_status: 'FAILED',
        google_sync_attempts: { increment: 1 },
        google_sync_error: message.slice(0, 2000),
      },
    });
    await recordEvent({
      level: 'ERROR',
      source: 'GOOGLE_SYNC',
      code: 'GOOGLE_SYNC_FAILED',
      message,
      context: { todo_id: todo.id },
    });
  }
}

export async function removeGoogleObjects(todo: Todo, oauth: OAuthToken | null): Promise<void> {
  if (!oauth || oauth.status !== 'CONNECTED') return;
  const calendarId = oauth.calendar_id ?? 'primary';
  const tasklistId = oauth.tasklist_id ?? '@default';
  try {
    await deleteCalendarEvent(todo.id, calendarId);
    await deleteGoogleTask(todo.id, tasklistId, todo.google_task_id);
  } catch (error) {
    await recordEvent({
      level: 'WARN',
      source: 'GOOGLE_SYNC',
      code: 'GOOGLE_DELETE_FAILED',
      message: error instanceof Error ? error.message : 'unknown',
      context: { todo_id: todo.id },
    });
  }
}
```

### 4.9 Modifikasi route to-do agar memicu sinkronisasi

Pada `app/api/todos/route.ts`, tambahkan import dan panggilan setelah `create`:

```ts
import { syncTodo } from '@/lib/google/sync';

// setelah const todo = await prisma.todo.create({...});
await syncTodo(todo.id);
const refreshed = await prisma.todo.findUniqueOrThrow({ where: { id: todo.id } });
return NextResponse.json({ ok: true, todo: refreshed });
```

Pada `app/api/todos/[id]/route.ts`:

```ts
import { syncTodo } from '@/lib/google/sync';

// setelah const todo = await prisma.todo.update({...});
await syncTodo(todo.id);
const refreshed = await prisma.todo.findUniqueOrThrow({ where: { id: todo.id } });
return NextResponse.json({ ok: true, todo: refreshed });
```

Untuk `DELETE`, ambil objek Google terlebih dahulu:

```ts
import { removeGoogleObjects } from '@/lib/google/sync';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const [todo, oauth] = await Promise.all([
    prisma.todo.findUnique({ where: { id: params.id } }),
    prisma.oAuthToken.findFirst({ where: { provider: 'google' } }),
  ]);
  if (!todo) {
    return NextResponse.json({ ok: false, error: 'tidak ditemukan' }, { status: 404 });
  }
  await removeGoogleObjects(todo, oauth);
  await prisma.todo.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
```

### 4.10 Halaman integrasi

`app/(app)/integrations/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { getSessionStatus } from '@/lib/waha/client';
import { IntegrationsPanel } from './IntegrationsPanel';

export default async function IntegrationsPage() {
  const [llmConfigs, google, waha] = await Promise.all([
    prisma.llmConfig.findMany({ orderBy: { is_active: 'desc' } }),
    prisma.oAuthToken.findFirst({ where: { provider: 'google' } }),
    getSessionStatus(),
  ]);

  return (
    <IntegrationsPanel
      initialConfigs={llmConfigs.map((config) => ({
        id: config.id,
        provider: config.provider,
        model: config.model,
        base_url: config.base_url,
        stt_model: config.stt_model,
        is_active: config.is_active,
        temperature: config.temperature,
        max_output_tokens: config.max_output_tokens,
        price_input_per_mtok: config.price_input_per_mtok ? Number(config.price_input_per_mtok) : null,
        price_output_per_mtok: config.price_output_per_mtok ? Number(config.price_output_per_mtok) : null,
      }))}
      google={{
        client_id: google?.client_id ?? '',
        status: google?.status ?? 'DISCONNECTED',
        account_email: google?.account_email ?? null,
      }}
      initialWahaStatus={waha.status}
    />
  );
}
```

`app/(app)/integrations/IntegrationsPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

type Config = {
  id: string;
  provider: string;
  model: string;
  base_url: string | null;
  stt_model: string | null;
  is_active: boolean;
  temperature: number;
  max_output_tokens: number;
  price_input_per_mtok: number | null;
  price_output_per_mtok: number | null;
};

type GoogleInfo = {
  client_id: string;
  status: string;
  account_email: string | null;
};

export function IntegrationsPanel({
  initialConfigs,
  google,
  initialWahaStatus,
}: {
  initialConfigs: Config[];
  google: GoogleInfo;
  initialWahaStatus: string;
}) {
  const [configs, setConfigs] = useState(initialConfigs);
  const [wahaStatus, setWahaStatus] = useState(initialWahaStatus);
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [googleForm, setGoogleForm] = useState({ client_id: google.client_id, client_secret: '' });
  const [qrKey, setQrKey] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(async () => {
      const response = await fetch('/api/waha/status');
      if (!response.ok) return;
      const data = await response.json();
      setWahaStatus(data.status);
      if (data.status === 'SCAN_QR_CODE') setQrKey(Date.now());
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  async function createConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/llm/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: form.get('provider'),
        model: form.get('model'),
        base_url: form.get('base_url') || null,
        api_key: form.get('api_key'),
        stt_model: form.get('stt_model') || null,
        temperature: Number(form.get('temperature') || 0.3),
        max_output_tokens: Number(form.get('max_output_tokens') || 1000),
        price_input_per_mtok: form.get('price_input_per_mtok') ? Number(form.get('price_input_per_mtok')) : null,
        price_output_per_mtok: form.get('price_output_per_mtok') ? Number(form.get('price_output_per_mtok')) : null,
        is_active: true,
      }),
    });
    if (!response.ok) {
      setMessage('Gagal menyimpan konfigurasi LLM.');
      return;
    }
    window.location.reload();
  }

  async function activate(id: string) {
    const response = await fetch(`/api/llm/configs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });
    if (!response.ok) {
      setMessage('Gagal mengaktifkan konfigurasi.');
      return;
    }
    setConfigs((current) => current.map((config) => ({ ...config, is_active: config.id === id })));
  }

  async function testConfig(id?: string) {
    const response = await fetch('/api/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { config_id: id } : {}),
    });
    const payload = await response.json();
    setMessage(payload.ok ? `LLM OK (${payload.latency_ms} ms)` : `LLM gagal: ${JSON.stringify(payload.error)}`);
  }

  async function startWaha() {
    const response = await fetch('/api/waha/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
    setMessage(response.ok ? 'Sesi WAHA dimulai; pindai QR.' : 'Gagal memulai sesi.');
    setQrKey(Date.now());
  }

  async function stopWaha() {
    const response = await fetch('/api/waha/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    setMessage(response.ok ? 'Sesi WAHA dihentikan.' : 'Gagal menghentikan sesi.');
  }

  async function makePairingCode() {
    const response = await fetch('/api/waha/pairing-code', { method: 'POST' });
    const payload = await response.json();
    setPairingCode(response.ok ? payload.code : '');
    if (!response.ok) setMessage('Gagal membuat kode pairing.');
  }

  async function saveGoogle(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/oauth/google/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(googleForm),
    });
    setMessage(response.ok ? 'Kredensial Google tersimpan.' : 'Gagal menyimpan kredensial Google.');
  }

  async function disconnectGoogle() {
    const response = await fetch('/api/google/disconnect', { method: 'POST' });
    setMessage(response.ok ? 'Google diputus.' : 'Gagal memutus Google.');
    window.location.reload();
  }

  const active = configs.find((config) => config.is_active);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Integrasi</h1>
      {message ? <p className="text-sm text-blue-700">{message}</p> : null}

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">LLM</h2>
        <p className="mb-3 text-sm text-gray-500">
          Aktif: {active ? `${active.provider} · ${active.model}` : 'belum ada'}
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {configs.map((config) => (
            <button
              key={config.id}
              onClick={() => activate(config.id)}
              className={`rounded border px-2 py-1 text-sm ${config.is_active ? 'bg-black text-white' : ''}`}
            >
              {config.provider} · {config.model}
            </button>
          ))}
          <button onClick={() => testConfig()} className="rounded border px-2 py-1 text-sm">Tes aktif</button>
        </div>
        <form onSubmit={createConfig} className="grid gap-2 md:grid-cols-4">
          <select name="provider" className="rounded border p-2">
            <option value="OPENAI">OPENAI</option>
            <option value="OPENROUTER">OPENROUTER</option>
            <option value="GEMINI">GEMINI</option>
            <option value="CUSTOM_OPENAI_COMPAT">CUSTOM_OPENAI_COMPAT</option>
            <option value="ANTHROPIC">ANTHROPIC</option>
          </select>
          <input name="model" placeholder="model" required className="rounded border p-2" />
          <input name="api_key" type="password" placeholder="API key" required className="rounded border p-2" />
          <input name="base_url" placeholder="base_url (opsional)" className="rounded border p-2" />
          <input name="stt_model" placeholder="stt_model (opsional)" className="rounded border p-2" />
          <input name="temperature" type="number" step="0.1" defaultValue="0.3" className="rounded border p-2" />
          <input name="max_output_tokens" type="number" defaultValue="1000" className="rounded border p-2" />
          <input name="price_input_per_mtok" type="number" step="0.0001" placeholder="harga input/M" className="rounded border p-2" />
          <input name="price_output_per_mtok" type="number" step="0.0001" placeholder="harga output/M" className="rounded border p-2" />
          <button type="submit" className="rounded bg-black p-2 text-white md:col-span-4">Simpan konfigurasi (aktif)</button>
        </form>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">WhatsApp (WAHA)</h2>
        <p className="mb-2 text-sm">Status: <span className="font-medium">{wahaStatus}</span></p>
        <div className="mb-3 flex gap-2">
          <button onClick={startWaha} className="rounded border px-3 py-2 text-sm">Mulai sesi</button>
          <button onClick={stopWaha} className="rounded border px-3 py-2 text-sm">Hentikan</button>
          <button onClick={makePairingCode} className="rounded border px-3 py-2 text-sm">Buat kode pairing</button>
        </div>
        {pairingCode ? (
          <p className="mb-3 text-sm">
            Kirim kode berikut ke nomor bot: <span className="font-mono font-semibold">{pairingCode}</span> (berlaku 10 menit)
          </p>
        ) : null}
        {wahaStatus === 'SCAN_QR_CODE' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/waha/qr?t=${qrKey}`} alt="QR WhatsApp" className="h-64 w-64 border" />
        ) : null}
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">Google</h2>
        <p className="mb-2 text-sm">
          Status: <span className="font-medium">{google.status}</span>
          {google.account_email ? ` · ${google.account_email}` : ''}
        </p>
        <form onSubmit={saveGoogle} className="mb-3 grid gap-2 md:grid-cols-3">
          <input
            value={googleForm.client_id}
            onChange={(event) => setGoogleForm((current) => ({ ...current, client_id: event.target.value }))}
            placeholder="OAuth client_id"
            className="rounded border p-2"
          />
          <input
            value={googleForm.client_secret}
            onChange={(event) => setGoogleForm((current) => ({ ...current, client_secret: event.target.value }))}
            placeholder="OAuth client_secret"
            type="password"
            className="rounded border p-2"
          />
          <button type="submit" className="rounded bg-black p-2 text-white">Simpan kredensial</button>
        </form>
        <p className="mb-3 text-xs text-gray-500">
          Redirect URI: {process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? ''}/api/oauth/google/callback
        </p>
        <div className="flex gap-2">
          <a href="/api/oauth/google/start" className="rounded border px-3 py-2 text-sm">Hubungkan Google</a>
          <button onClick={disconnectGoogle} className="rounded border px-3 py-2 text-sm">Putuskan</button>
        </div>
      </section>
    </div>
  );
}
```

> Agar redirect URI tampil, tambahkan `NEXT_PUBLIC_PUBLIC_BASE_URL=${PUBLIC_BASE_URL}` pada build arg dashboard bila diperlukan. Nilai ini hanya untuk tampilan; alur OAuth memakai `PUBLIC_BASE_URL` di server.

## 5. Definition of Done

```bash
cd dashboard && npm run build
cd .. && docker compose up -d --build && docker compose ps
```

Skenario verifikasi:

1. **Settings**: ubah `work_hours_end`, simpan. Cek:
   ```bash
   docker exec botseri-db psql -U botseri -d botseri -tAc \
     "SELECT work_hours_end, compiled_prompt_version FROM bot_settings;"
   ```
   Nilai berubah dan versi prompt naik.
2. **LLM**: simpan konfigurasi OPENAI + API key, tekan "Tes aktif".
   - Respons `ok: true` dan baris `llm_usage_logs` bertambah (call dari endpoint tes tidak mencatat usage karena memakai adapter langsung; verifikasi gateway dilakukan pada Step 06).
   - Pastikan DB tidak menyimpan plaintext:
     ```bash
     docker exec botseri-db psql -U botseri -d botseri -tAc \
       "SELECT api_key_enc FROM llm_configs WHERE is_active;"
     ```
     Nilai diawali `v1:` dan tidak sama dengan API key.
3. **WAHA**: klik "Mulai sesi" → status berubah menjadi `SCAN_QR_CODE`, QR tampil. Pindai dengan nomor bot → status `WORKING`.
4. **Pairing**: buat kode, kirim ke nomor bot dari nomor owner.
   - `authorized_numbers` bertambah dengan `is_owner = true`.
   - `pairing_codes.used_at` terisi.
5. **Google**: simpan `client_id`/`client_secret`, buka "Hubungkan Google", setujui consent.
   - `oauth_tokens.status = CONNECTED`, `account_email` terisi, kolom `*_enc` diawali `v1:`.
6. **Sinkronisasi**: buat to-do dengan jam spesifik → event Calendar muncul; to-do tanpa jam → task Google Tasks muncul. `google_sync_status = SYNCED`.
7. **Kegagalan Google**: cabut akses di Google Account → `syncTodo` menandai `FAILED`, `google_sync_attempts` bertambah, `system_events` memuat `GOOGLE_SYNC_FAILED`.

Kriteria lulus:

- `npm run build` sukses.
- Semua rahasia tersimpan terenkripsi (prefix `v1:`).
- QR dan status WAHA dapat diakses dari dashboard tanpa mengekspos WAHA ke host.
- To-do baru tersinkron ke Google dan statusnya tercatat di DB.
- Tidak ada API key atau token di log.
