# Step 02 — Database, Prisma ORM, dan Utilitas Enkripsi

## 1. Goal

Menyiapkan PostgreSQL sebagai SSOT dan menghubungkannya ke dashboard:

- Prisma schema 100% sinkron dengan [`docs/DATABASE.md`](../DATABASE.md) (15 tabel, 12 enum, 1 view).
- Migrasi awal forward-only, termasuk `v_active_todos`.
- Seed idempoten: `bot_settings` singleton + Priority Stack florist.
- Utilitas AES-256-GCM dengan format `v1:<kid>:<iv>:<ciphertext>:<tag>` dan AAD `<tabel>.<kolom>` (§15.1).
- Healthcheck `/api/internal/health` yang benar-benar memeriksa DB dan versi migrasi.

Setelah step ini, `docker compose up -d` harus menyalakan keempat container inti dan seluruhnya sehat.

## 2. Prerequisites

- Step 01 selesai: compose valid, `botseri-db` sehat, image dashboard dan n8n dapat di-build.
- `.env` sudah berisi `POSTGRES_*` dan `ENCRYPTION_KEY` (32 byte base64).

## 3. File yang Dibuat / Dimodifikasi

```text
dashboard/
├── package.json                         # dependencies Prisma, zod, argon2, jose; prisma.seed
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   │   └── <timestamp>_init/
│   │       └── migration.sql            # dihasilkan Prisma + SQL view
│   └── seed.cjs
├── src/
│   ├── lib/
│   │   ├── db.ts
│   │   ├── env.ts
│   │   └── crypto/
│   │       └── index.ts
│   └── app/api/internal/health/route.ts
├── scripts/
│   └── rotate-encryption.ts
└── tests/unit/crypto.test.ts
```

## 4. Langkah Implementasi

### 4.1 Dependensi dan konfigurasi paket

```bash
cd dashboard
npm install @prisma/client prisma zod argon2 jose googleapis date-fns date-fns-tz
npm install -D tsx vitest @types/node
```

`prisma` wajib di `dependencies` (bukan `devDependencies`) karena `docker-entrypoint.sh` menjalankan `npx prisma migrate deploy` pada image produksi.

Tambahkan pada `dashboard/package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "prisma db seed",
    "db:studio": "prisma studio"
  },
  "prisma": {
    "seed": "node prisma/seed.cjs"
  }
}
```

### 4.1.1 `dashboard/Dockerfile` — Prisma di image produksi

Prisma Client harus di-generate saat build dan CLI + folder `prisma/` harus ada di image runtime agar `prisma migrate deploy` pada entrypoint bekerja:

```dockerfile
# builder
COPY . .
RUN npx prisma generate
RUN npm run build

# runner, setelah npm ci --omit=dev
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate
```

Tanpa dua baris `COPY`/`RUN` terakhir, container gagal dengan `Could not find Prisma Schema` atau `@prisma/client did not initialize yet`.

### 4.2 `dashboard/prisma/schema.prisma`

Field memakai `snake_case` agar identik dengan kolom SQL (tanpa `@map` per kolom). Nama tabel tetap dipetakan eksplisit dengan `@@map`.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum BehaviorMode {
  STRICT
  SANTAI
}

enum PromptMode {
  STACK
  CUSTOM
}

enum TodoStatus {
  PENDING
  IN_PROGRESS
  DONE
  CANCELLED
}

enum GoogleSyncStatus {
  NOT_REQUIRED
  PENDING
  SYNCED
  FAILED
}

enum GoogleSyncMode {
  AUTO
  BOTH
}

enum JobType {
  MORNING_BRIEF
  WORK_HOURS_REMINDER
  END_OF_DAY_EVAL
}

enum JobStatus {
  CLAIMED
  SENT
  FAILED
  SKIPPED
}

enum EvalTier {
  HIGH
  MID
  LOW
  NO_TASKS
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum OAuthStatus {
  CONNECTED
  NEEDS_REAUTH
  DISCONNECTED
}

enum OrderPaymentStatus {
  UNPAID
  DP_PAID
  PAID
}

enum TodoCreatedVia {
  CHAT
  DASHBOARD
  SYSTEM
}

model AdminUser {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  username      String   @unique @db.VarChar(255)
  password_hash String   @db.Text
  created_at    DateTime @default(now()) @db.Timestamptz
  updated_at    DateTime @default(now()) @updatedAt @db.Timestamptz

  @@map("admin_users")
}

model BotSettings {
  id                      Int            @id @default(1)
  brand_name              String         @default("") @db.VarChar(100)
  business_type           String         @default("") @db.VarChar(100)
  owner_name              String         @default("") @db.VarChar(100)
  timezone                String         @default("Asia/Jakarta") @db.VarChar(50)
  work_hours_start        String         @default("08:00") @db.VarChar(5)
  work_hours_end          String         @default("17:00") @db.VarChar(5)
  early_brief_time        String         @default("06:00") @db.VarChar(5)
  working_days            Int[]          @default([1, 2, 3, 4, 5, 6])
  behavior_mode           BehaviorMode   @default(STRICT)
  behavior_instruction    String?        @db.Text
  prompt_mode             PromptMode     @default(STACK)
  custom_prompt_template  String?        @db.Text
  compiled_prompt         String?        @db.Text
  compiled_prompt_version Int            @default(1)
  compiled_at             DateTime?      @db.Timestamptz
  reminder_interval_minutes Int          @default(120)
  reminder_max_per_day    Int            @default(5)
  reminder_max_rank       Int            @default(2)
  brief_window_minutes    Int            @default(120)
  eod_window_minutes      Int            @default(120)
  default_due_time        String         @default("17:00") @db.VarChar(5)
  google_sync_mode        GoogleSyncMode @default(AUTO)
  bot_enabled             Boolean        @default(true)
  setup_completed         Boolean        @default(false)
  created_at              DateTime       @default(now()) @db.Timestamptz
  updated_at              DateTime       @default(now()) @updatedAt @db.Timestamptz

  @@map("bot_settings")
}

model PriorityLevel {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  rank        Int     @unique
  label       String  @db.VarChar(50)
  description String? @db.Text
  rule_text   String  @db.Text
  color       String? @db.VarChar(20)
  created_at  DateTime @default(now()) @db.Timestamptz
  updated_at  DateTime @default(now()) @updatedAt @db.Timestamptz
  todos       Todo[]

  @@map("priority_levels")
}

model Order {
  id               String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  customer_name    String             @db.VarChar(150)
  customer_contact String?            @db.VarChar(50)
  description      String             @db.Text
  event_date       DateTime?          @db.Timestamptz
  delivery_date    DateTime?          @db.Timestamptz
  delivery_address String?            @db.Text
  total_amount     Decimal?           @db.Decimal(14, 2)
  dp_amount        Decimal?           @db.Decimal(14, 2)
  payment_status   OrderPaymentStatus @default(UNPAID)
  notes            String?            @db.Text
  created_at       DateTime           @default(now()) @db.Timestamptz
  updated_at       DateTime           @default(now()) @updatedAt @db.Timestamptz
  todos            Todo[]

  @@map("orders")
}

model Todo {
  id                   String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  title                String           @db.VarChar(120)
  description          String?          @db.Text
  category             String?          @db.VarChar(40)
  status               TodoStatus       @default(PENDING)
  priority_level_id    String?          @db.Uuid
  priority_rank        Int
  due_at               DateTime?        @db.Timestamptz
  has_specific_time    Boolean          @default(false)
  planned_date         DateTime         @db.Date
  order_id             String?          @db.Uuid
  rollover_count       Int              @default(0)
  completed_at         DateTime?        @db.Timestamptz
  source_message_id    String?          @db.VarChar(255)
  dedupe_key           String?          @unique @db.VarChar(64)
  created_via          TodoCreatedVia   @default(CHAT)
  calendar_event_id    String?          @db.VarChar(255)
  google_task_id       String?          @db.VarChar(255)
  google_sync_status   GoogleSyncStatus @default(NOT_REQUIRED)
  google_sync_attempts Int              @default(0)
  google_sync_error    String?          @db.Text
  created_at           DateTime         @default(now()) @db.Timestamptz
  updated_at           DateTime         @default(now()) @updatedAt @db.Timestamptz

  priority_level PriorityLevel? @relation(fields: [priority_level_id], references: [id], onDelete: SetNull)
  order          Order?         @relation(fields: [order_id], references: [id], onDelete: SetNull)

  @@index([planned_date, status])
  @@index([priority_rank])
  @@index([google_sync_status, google_sync_attempts])
  @@map("todos")
}

model AuthorizedNumber {
  id         String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  chat_id    String  @unique @db.VarChar(100)
  phone_e164 String? @db.VarChar(20)
  label      String? @db.VarChar(100)
  is_owner   Boolean @default(false)
  created_at DateTime @default(now()) @db.Timestamptz

  @@map("authorized_numbers")
}

model PairingCode {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  code_hash  String    @unique @db.VarChar(64)
  expires_at DateTime  @db.Timestamptz
  used_at    DateTime? @db.Timestamptz
  created_at DateTime  @default(now()) @db.Timestamptz

  @@map("pairing_codes")
}

model MessageLog {
  id            String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  direction     MessageDirection
  wa_message_id String?          @unique @db.VarChar(255)
  chat_id       String           @db.VarChar(100)
  body          String?          @db.Text
  media_type    String?          @db.VarChar(50)
  transcript    String?          @db.Text
  in_reply_to   String?          @db.VarChar(255)
  created_at    DateTime         @default(now()) @db.Timestamptz

  @@index([chat_id, created_at])
  @@map("message_log")
}

model LlmConfig {
  id                    String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  provider              String   @db.VarChar(50)
  model                 String   @db.VarChar(100)
  base_url              String?  @db.VarChar(255)
  api_key_enc           String   @db.Text
  stt_model             String?  @db.VarChar(100)
  temperature           Float    @default(0.3)
  max_output_tokens     Int      @default(1000)
  price_input_per_mtok  Decimal? @db.Decimal(10, 4)
  price_output_per_mtok Decimal? @db.Decimal(10, 4)
  is_active             Boolean  @default(true)
  created_at            DateTime @default(now()) @db.Timestamptz
  updated_at            DateTime @default(now()) @updatedAt @db.Timestamptz

  @@map("llm_configs")
}

model OAuthToken {
  id                String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  provider          String      @default("google") @db.VarChar(50)
  account_email     String?     @db.VarChar(255)
  scopes            String[]
  client_id         String?     @db.VarChar(255)
  client_secret_enc String?     @db.Text
  access_token_enc  String?     @db.Text
  refresh_token_enc String?     @db.Text
  expires_at        DateTime?   @db.Timestamptz
  status            OAuthStatus @default(DISCONNECTED)
  calendar_id       String?     @default("primary") @db.VarChar(255)
  tasklist_id       String?     @db.VarChar(255)
  created_at        DateTime    @default(now()) @db.Timestamptz
  updated_at        DateTime    @default(now()) @updatedAt @db.Timestamptz

  @@map("oauth_tokens")
}

model LlmUsageLog {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ts                DateTime @default(now()) @db.Timestamptz
  call_type         String   @db.VarChar(50)
  provider          String   @db.VarChar(50)
  model             String   @db.VarChar(100)
  prompt_tokens     Int      @default(0)
  completion_tokens Int      @default(0)
  cost_usd          Decimal? @db.Decimal(10, 6)
  latency_ms        Int?
  n8n_execution_id  String?  @db.VarChar(100)
  success           Boolean  @default(true)
  error             String?  @db.Text

  @@index([ts, call_type])
  @@map("llm_usage_logs")
}

model DailyExecutionLog {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  local_date DateTime  @db.Date
  job_type   JobType
  seq        Int       @default(0)
  status     JobStatus @default(CLAIMED)
  attempts   Int       @default(1)
  claimed_at DateTime  @default(now()) @db.Timestamptz
  sent_at    DateTime? @db.Timestamptz
  error      String?   @db.Text

  @@unique([local_date, job_type, seq])
  @@map("daily_execution_logs")
}

model DailyStat {
  local_date        DateTime @id @db.Date
  target_count      Int
  done_count        Int
  pending_count     Int
  completion_rate   Decimal? @db.Decimal(5, 2)
  tier              EvalTier
  rolled_over_count Int      @default(0)
  snapshot_at       DateTime @default(now()) @db.Timestamptz

  @@map("daily_stats")
}

model Holiday {
  date       DateTime @id @db.Date
  label      String   @db.VarChar(100)
  created_at DateTime @default(now()) @db.Timestamptz

  @@map("holidays")
}

model SystemEvent {
  id      String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ts      DateTime @default(now()) @db.Timestamptz
  level   String   @db.VarChar(20)
  source  String   @db.VarChar(50)
  code    String   @db.VarChar(50)
  message String   @db.Text
  context Json?    @db.JsonB

  @@index([ts, level])
  @@map("system_events")
}
```

### 4.3 Migrasi awal dan view `v_active_todos`

Buat migrasi tanpa menerapkannya, lalu tambahkan DDL view ke file migrasi:

```bash
cd dashboard
npx prisma migrate dev --name init --create-only
```

Buka `dashboard/prisma/migrations/<timestamp>_init/migration.sql` dan tambahkan di bagian paling akhir:

```sql
CREATE OR REPLACE VIEW v_active_todos AS
SELECT
    t.id,
    t.title,
    t.description,
    t.category,
    t.status,
    t.priority_level_id,
    p.rank  AS priority_rank,
    p.label AS priority_label,
    p.color AS priority_color,
    t.due_at,
    t.has_specific_time,
    t.planned_date,
    t.order_id,
    t.rollover_count,
    t.created_via,
    t.google_sync_status,
    t.created_at,
    t.updated_at
FROM todos t
LEFT JOIN priority_levels p ON t.priority_level_id = p.id
WHERE t.status IN ('PENDING', 'IN_PROGRESS')
ORDER BY p.rank ASC, t.due_at ASC NULLS LAST, t.created_at ASC;
```

Terapkan migrasi:

```bash
npx prisma migrate dev
npx prisma generate
```

> Tidak ada `init.sql` berisi DDL tabel. Invarian INV-12 melarang perubahan skema di luar migrasi Prisma. `gen_random_uuid()` sudah tersedia di PostgreSQL 16 tanpa extension.

### 4.4 `dashboard/src/lib/env.ts`

Validasi env sekali di proses, gagal cepat bila ada yang hilang.

```ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(44),
  ENCRYPTION_KEY_PREVIOUS: z.string().min(44).optional(),
  INTERNAL_API_TOKEN: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  SETUP_TOKEN: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url(),
  TZ_DEFAULT: z.string().default('Asia/Jakarta'),
  WAHA_API_KEY: z.string().min(16),
  WAHA_SESSION: z.string().default('default'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);
```

### 4.5 `dashboard/src/lib/db.ts`

Singleton Prisma Client untuk mencegah kebocoran koneksi saat hot reload.

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

### 4.6 `dashboard/src/lib/crypto/index.ts`

```ts
import crypto from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(name: 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_PREVIOUS'): Buffer {
  const encoded = process.env[name];
  if (!encoded) {
    throw new Error(`${name} tidak diatur`);
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} harus berupa 32 byte base64`);
  }
  return key;
}

function keyId(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export function encryptSecret(plaintext: string, aad: string): string {
  const key = loadKey('ENCRYPTION_KEY');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    keyId(key),
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

export function decryptSecret(stored: string, aad: string): string {
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('format ciphertext tidak dikenal');
  }
  const [, kid, ivB64, ciphertextB64, tagB64] = parts;
  const primary = loadKey('ENCRYPTION_KEY');
  const previous = process.env.ENCRYPTION_KEY_PREVIOUS
    ? loadKey('ENCRYPTION_KEY_PREVIOUS')
    : null;

  const key = keyId(primary) === kid ? primary : previous && keyId(previous) === kid ? previous : null;
  if (!key) {
    throw new Error(`kid ${kid} tidak cocok dengan kunci yang tersedia`);
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('iv atau tag tidak valid');
  }

  const decipher = crypto.createDecipheriv(CIPHER, key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function rotateSecret(stored: string, aad: string): string {
  return encryptSecret(decryptSecret(stored, aad), aad);
}
```

AAD yang dipakai konsisten di seluruh aplikasi:

| Tabel | Kolom | AAD |
|---|---|---|
| `llm_configs` | `api_key_enc` | `llm_configs.api_key_enc` |
| `oauth_tokens` | `client_secret_enc` | `oauth_tokens.client_secret_enc` |
| `oauth_tokens` | `access_token_enc` | `oauth_tokens.access_token_enc` |
| `oauth_tokens` | `refresh_token_enc` | `oauth_tokens.refresh_token_enc` |

### 4.7 `dashboard/scripts/rotate-encryption.ts`

Dijalankan setelah `ENCRYPTION_KEY` baru dipasang dan kunci lama dipindahkan ke `ENCRYPTION_KEY_PREVIOUS`.

```ts
import { PrismaClient } from '@prisma/client';
import { rotateSecret } from '../src/lib/crypto';

const prisma = new PrismaClient();

async function main() {
  if (!process.env.ENCRYPTION_KEY_PREVIOUS) {
    throw new Error('ENCRYPTION_KEY_PREVIOUS wajib diisi selama rotasi');
  }

  const configs = await prisma.llmConfig.findMany();
  for (const config of configs) {
    await prisma.llmConfig.update({
      where: { id: config.id },
      data: { api_key_enc: rotateSecret(config.api_key_enc, 'llm_configs.api_key_enc') },
    });
  }

  const tokens = await prisma.oAuthToken.findMany();
  for (const token of tokens) {
    await prisma.oAuthToken.update({
      where: { id: token.id },
      data: {
        client_secret_enc: token.client_secret_enc
          ? rotateSecret(token.client_secret_enc, 'oauth_tokens.client_secret_enc')
          : null,
        access_token_enc: token.access_token_enc
          ? rotateSecret(token.access_token_enc, 'oauth_tokens.access_token_enc')
          : null,
        refresh_token_enc: token.refresh_token_enc
          ? rotateSecret(token.refresh_token_enc, 'oauth_tokens.refresh_token_enc')
          : null,
      },
    });
  }

  console.log(`rotasi selesai: ${configs.length} llm_configs, ${tokens.length} oauth_tokens`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

### 4.8 `dashboard/prisma/seed.cjs`

Idempoten; aman dijalankan berulang. Memakai JavaScript CommonJS agar dapat dijalankan image runtime yang hanya memasang dependency produksi.

```js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const priorityStack = [
  {
    rank: 1,
    label: 'Kritis',
    description: 'Eksekusi dekorasi dan pengiriman buket Hari-H atau besok.',
    rule_text: 'Gunakan untuk pekerjaan dengan deadline kurang dari 24 jam atau acara Hari-H.',
    color: '#dc2626',
  },
  {
    rank: 2,
    label: 'Penting dan mudah rusak',
    description: 'Belanja bunga segar dan conditioning bahan mudah layu.',
    rule_text: 'Gunakan untuk belanja bahan, perawatan bunga, dan pekerjaan yang rusak bila ditunda.',
    color: '#ea580c',
  },
  {
    rank: 3,
    label: 'Cashflow',
    description: 'Penagihan DP dan pelunasan invoice klien.',
    rule_text: 'Gunakan untuk penagihan, konfirmasi pembayaran, dan follow-up pelunasan.',
    color: '#ca8a04',
  },
  {
    rank: 4,
    label: 'Rutin',
    description: 'Operasional gudang, rekap admin, dan balas chat inquiry baru.',
    rule_text: 'Gunakan untuk pekerjaan rutin yang tidak memiliki tenggat mendesak.',
    color: '#2563eb',
  },
];

async function main() {
  await prisma.botSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      brand_name: 'Toko Bunga Contoh',
      business_type: 'Florist',
      owner_name: 'Owner',
      timezone: 'Asia/Jakarta',
      work_hours_start: '08:00',
      work_hours_end: '17:00',
      early_brief_time: '06:00',
      working_days: [1, 2, 3, 4, 5, 6],
      behavior_mode: 'STRICT',
      prompt_mode: 'STACK',
      setup_completed: false,
    },
  });

  for (const level of priorityStack) {
    await prisma.priorityLevel.upsert({
      where: { rank: level.rank },
      update: {
        label: level.label,
        description: level.description,
        rule_text: level.rule_text,
        color: level.color,
      },
      create: level,
    });
  }

  console.log('seed selesai: bot_settings + 4 priority_levels');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

### 4.9 `dashboard/src/app/api/internal/health/route.ts`

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return NextResponse.json({
      status: 'ok',
      db: true,
      migration: rows[0]?.migration_name ?? null,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'health',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
    return NextResponse.json({ status: 'error', db: false }, { status: 503 });
  }
}
```

Healthcheck ini tidak memerlukan bearer token karena dipakai oleh Docker dan entrypoint n8n. Rute berada di jaringan internal dan diblokir dari tunnel pada Step 08.

### 4.10 Unit test kriptografi

`dashboard/tests/unit/crypto.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
});

describe('crypto', () => {
  it('melakukan round trip dengan AAD yang sama', async () => {
    const { encryptSecret, decryptSecret } = await import('../../src/lib/crypto');
    const stored = encryptSecret('sk-rahasia-123', 'llm_configs.api_key_enc');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(decryptSecret(stored, 'llm_configs.api_key_enc')).toBe('sk-rahasia-123');
  });

  it('menolak AAD yang berbeda', async () => {
    const { encryptSecret, decryptSecret } = await import('../../src/lib/crypto');
    const stored = encryptSecret('token', 'oauth_tokens.access_token_enc');
    expect(() => decryptSecret(stored, 'oauth_tokens.refresh_token_enc')).toThrow();
  });

  it('mendekripsi ciphertext yang dienkripsi kunci sebelumnya', async () => {
    const previous = crypto.randomBytes(32).toString('base64');
    process.env.ENCRYPTION_KEY_PREVIOUS = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = previous;
    const { encryptSecret, decryptSecret } = await import('../../src/lib/crypto');
    const stored = encryptSecret('nilai', 'llm_configs.api_key_enc');
    expect(decryptSecret(stored, 'llm_configs.api_key_enc')).toBe('nilai');
  });
});
```

> Prisma CLI 5.x membaca `DATABASE_URL` dari `dashboard/.env` untuk perintah lokal. Jangan membuat `.env` berisi rahasia; cukup ekspor variabel saat menjalankan perintah (lihat 4.11).

### 4.11 Menjalankan migrasi tanpa mengekspos port database

Port `5432` tidak dipetakan ke host (INV-01). Jalankan Prisma di dalam container dengan bind mount hanya pada direktori `prisma/` agar file migrasi tersimpan di host:

```bash
# dari root repo
docker compose build botseri-dashboard
docker compose run --rm \
  -v "$PWD/dashboard/prisma:/app/prisma" \
  botseri-dashboard npx prisma migrate dev --name init

docker compose run --rm \
  -v "$PWD/dashboard/prisma:/app/prisma" \
  botseri-dashboard npx prisma db seed
```

Setelah migrasi, build ulang image agar migrasi ikut ke dalam image:

```bash
docker compose build botseri-dashboard
```

## 5. Definition of Done

```bash
# 1. Schema valid dan tidak ada drift
cd dashboard && npx prisma validate && npx prisma migrate status

# 2. Unit test crypto hijau
npm test -- tests/unit/crypto.test.ts

# 3. Seluruh stack inti hidup dan sehat (Step 01 + 02)
cd .. && docker compose up -d
docker compose ps

# 4. Healthcheck melaporkan DB dan migrasi
curl -fsS http://127.0.0.1:3000/api/internal/health
# {"status":"ok","db":true,"migration":"<timestamp>_init"}

# 5. View tersedia dan kosong (belum ada to-do)
docker exec botseri-db psql -U botseri -d botseri -c "SELECT count(*) FROM v_active_todos;"

# 6. Seed idempoten: jalankan dua kali, jumlah priority_levels tetap 4
docker exec botseri-db psql -U botseri -d botseri -c "SELECT count(*) FROM priority_levels;"
docker exec botseri-db psql -U botseri -d botseri -c "SELECT count(*) FROM bot_settings;"
```

Kriteria lulus:

- `prisma migrate status` melaporkan `Database schema is up to date!`.
- `npm test` hijau untuk tiga kasus crypto.
- `docker compose ps` menunjukkan `botseri-db`, `botseri-dashboard`, `botseri-waha`, `botseri-n8n` berjalan; dashboard `healthy`.
- `GET /api/internal/health` mengembalikan `200` dengan `db: true`.
- `priority_levels` berisi 4 baris dan `bot_settings` tepat 1 baris setelah seed dijalankan dua kali.
