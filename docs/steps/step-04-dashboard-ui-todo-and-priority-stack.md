# Step 04 — Dashboard: Live Board, Orders, Priority Stack, Prompt Editor

## 1. Goal

Membangun antarmuka operasional yang menjadi sumber konfigurasi dinamis:

- Layout aplikasi dengan sesi admin dan navigasi.
- Ringkasan hari ini: 3 fokus utama, hitungan tugas, status integrasi.
- Live board `todos` dan `orders` dengan CRUD.
- Priority Stack drag-and-drop (`@dnd-kit`) yang langsung mengompilasi ulang prompt.
- Editor prompt mode `STACK` / `CUSTOM` dengan pratinjau hasil render per trigger.

Semua mutasi melewati API admin yang dilindungi sesi dan CSRF middleware dari Step 03.

## 2. Prerequisites

- Step 03 selesai: login, setup, `compiled_prompt`, dan internal API berjalan.
- `docker compose up -d` sehat.

## 3. File yang Dibuat / Dimodifikasi

```text
dashboard/src/
├── app/
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── todos/page.tsx
│   │   ├── todos/TodoBoard.tsx
│   │   ├── orders/page.tsx
│   │   ├── orders/OrderBoard.tsx
│   │   ├── priority-stack/page.tsx
│   │   ├── priority-stack/StackEditor.tsx
│   │   └── prompt/page.tsx
│   │       └── PromptEditor.tsx
│   └── api/
│       ├── todos/route.ts
│       ├── todos/[id]/route.ts
│       ├── orders/route.ts
│       ├── orders/[id]/route.ts
│       ├── priority-levels/route.ts
│       ├── priority-levels/[id]/route.ts
│       ├── priority-levels/reorder/route.ts
│       ├── prompt/route.ts
│       └── prompt/preview/route.ts
└── components/
    └── LogoutButton.tsx
```

## 4. Langkah Implementasi

### 4.1 Dependensi drag-and-drop

```bash
cd dashboard
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### 4.2 `components/LogoutButton.tsx`

```tsx
'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button onClick={logout} className="text-sm text-gray-600 hover:text-black">
      Keluar
    </button>
  );
}
```

### 4.3 `app/(app)/layout.tsx`

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { LogoutButton } from '@/components/LogoutButton';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/todos', label: 'To-Do' },
  { href: '/orders', label: 'Pesanan' },
  { href: '/priority-stack', label: 'Priority Stack' },
  { href: '/prompt', label: 'Prompt' },
  { href: '/settings', label: 'Pengaturan' },
  { href: '/integrations', label: 'Integrasi' },
  { href: '/analytics', label: 'Analitik' },
  { href: '/logs', label: 'Log' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  if (!settings?.setup_completed) redirect('/setup');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold">{settings.brand_name || 'Botseri'}</span>
          <nav className="flex flex-1 flex-wrap gap-3 text-sm">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="text-gray-600 hover:text-black">
                {link.label}
              </Link>
            ))}
          </nav>
          <span className="text-sm text-gray-500">{session.username}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
```

### 4.4 `app/(app)/dashboard/page.tsx`

```tsx
import { prisma } from '@/lib/db';
import { localDateString } from '@/lib/time';

type FocusRow = {
  id: string;
  title: string;
  priority_rank: number;
  priority_label: string | null;
  due_at: Date | null;
  planned_date: Date;
};

export default async function DashboardPage() {
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = localDateString(new Date(), settings.timezone);
  const todayDate = new Date(`${today}T00:00:00Z`);

  const [target, done, focus, llm, google] = await Promise.all([
    prisma.todo.count({ where: { planned_date: todayDate, status: { not: 'CANCELLED' } } }),
    prisma.todo.count({ where: { planned_date: todayDate, status: 'DONE' } }),
    prisma.$queryRaw<FocusRow[]>`
      SELECT id, title, priority_rank, priority_label, due_at, planned_date
      FROM v_active_todos
      WHERE planned_date <= ${todayDate}
      LIMIT 3
    `,
    prisma.llmConfig.findFirst({ where: { is_active: true } }),
    prisma.oAuthToken.findFirst({ where: { provider: 'google' } }),
  ]);

  const rate = target > 0 ? Math.round((done / target) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-semibold">Ringkasan Hari Ini</h1>
        <p className="text-sm text-gray-500">{today} · {settings.timezone}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded border bg-white p-4">
          <p className="text-sm text-gray-500">Penyelesaian</p>
          <p className="text-3xl font-semibold">{rate === null ? '—' : `${rate}%`}</p>
          <p className="text-sm text-gray-500">{done} dari {target} tugas</p>
        </div>
        <div className="rounded border bg-white p-4">
          <p className="text-sm text-gray-500">LLM</p>
          <p className="font-medium">{llm ? `${llm.provider} · ${llm.model}` : 'Belum dikonfigurasi'}</p>
        </div>
        <div className="rounded border bg-white p-4">
          <p className="text-sm text-gray-500">Google</p>
          <p className="font-medium">{google?.status ?? 'Belum terhubung'}</p>
        </div>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-semibold">🔥 3 Fokus Utama</h2>
        {focus.length === 0 ? (
          <p className="text-sm text-gray-500">Belum ada tugas aktif untuk hari ini.</p>
        ) : (
          <ol className="list-decimal space-y-2 pl-5">
            {focus.map((todo) => (
              <li key={todo.id}>
                <span className="font-medium">{todo.title}</span>
                <span className="ml-2 text-sm text-gray-500">
                  rank {todo.priority_rank} · {todo.priority_label ?? 'tanpa label'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
```

### 4.5 `app/api/todos/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { localDateString } from '@/lib/time';

const createSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(4000).nullable().optional(),
  category: z.string().max(40).nullable().optional(),
  priority_rank: z.number().int().min(1),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  has_specific_time: z.boolean(),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const todos = await prisma.todo.findMany({
    where: status ? { status: status as never } : {},
    orderBy: [{ priority_rank: 'asc' }, { due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
    take: 200,
  });
  return NextResponse.json({ ok: true, todos });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const [level, settings] = await Promise.all([
    prisma.priorityLevel.findUnique({ where: { rank: input.priority_rank } }),
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  if (!level) {
    return NextResponse.json({ ok: false, error: 'priority_rank tidak ada' }, { status: 400 });
  }

  const dueAt = input.due_at ? new Date(input.due_at) : null;
  const plannedDate =
    input.planned_date ??
    (dueAt ? localDateString(dueAt, settings.timezone) : localDateString(new Date(), settings.timezone));

  const todo = await prisma.todo.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      priority_rank: level.rank,
      priority_level_id: level.id,
      due_at: dueAt,
      has_specific_time: input.has_specific_time,
      planned_date: new Date(`${plannedDate}T00:00:00Z`),
      status: 'PENDING',
      created_via: 'DASHBOARD',
    },
  });

  return NextResponse.json({ ok: true, todo });
}
```

### 4.6 `app/api/todos/[id]/route.ts`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { localDateString } from '@/lib/time';

const updateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).nullable().optional(),
  category: z.string().max(40).nullable().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  priority_rank: z.number().int().min(1).optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  has_specific_time: z.boolean().optional(),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const existing = await prisma.todo.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'tidak ditemukan' }, { status: 404 });
  }
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });

  let levelId = existing.priority_level_id;
  let rank = existing.priority_rank;
  if (input.priority_rank !== undefined) {
    const level = await prisma.priorityLevel.findUnique({ where: { rank: input.priority_rank } });
    if (!level) {
      return NextResponse.json({ ok: false, error: 'priority_rank tidak ada' }, { status: 400 });
    }
    levelId = level.id;
    rank = level.rank;
  }

  const dueAt =
    input.due_at === undefined ? existing.due_at : input.due_at === null ? null : new Date(input.due_at);

  let plannedDate = existing.planned_date;
  if (input.planned_date) {
    plannedDate = new Date(`${input.planned_date}T00:00:00Z`);
  } else if (input.due_at !== undefined && dueAt) {
    plannedDate = new Date(`${localDateString(dueAt, settings.timezone)}T00:00:00Z`);
  }

  const status = input.status ?? existing.status;
  const completedAt =
    status === 'DONE' ? existing.completed_at ?? new Date() : null;

  const todo = await prisma.todo.update({
    where: { id: params.id },
    data: {
      title: input.title ?? existing.title,
      description: input.description === undefined ? existing.description : input.description,
      category: input.category === undefined ? existing.category : input.category,
      status,
      completed_at: completedAt,
      priority_level_id: levelId,
      priority_rank: rank,
      due_at: dueAt,
      has_specific_time: input.has_specific_time ?? existing.has_specific_time,
      planned_date: plannedDate,
      google_sync_status: existing.google_sync_status === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'PENDING',
    },
  });

  return NextResponse.json({ ok: true, todo });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const deleted = await prisma.todo.deleteMany({ where: { id: params.id } });
  if (deleted.count === 0) {
    return NextResponse.json({ ok: false, error: 'tidak ditemukan' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

> Sinkronisasi Google dipicu pada Step 05 dengan memanggil `syncTodo()` dari route yang sama. Nilai `google_sync_status` di atas hanya menandai kebutuhan sinkronisasi.

### 4.7 `app/(app)/todos/page.tsx` dan `TodoBoard.tsx`

`page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { TodoBoard } from './TodoBoard';

export default async function TodosPage() {
  const [todos, levels] = await Promise.all([
    prisma.todo.findMany({
      orderBy: [{ priority_rank: 'asc' }, { due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
      take: 200,
    }),
    prisma.priorityLevel.findMany({ orderBy: { rank: 'asc' } }),
  ]);

  return (
    <TodoBoard
      initialTodos={todos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        status: todo.status,
        priority_rank: todo.priority_rank,
        due_at: todo.due_at?.toISOString() ?? null,
        planned_date: todo.planned_date.toISOString().slice(0, 10),
        category: todo.category,
        google_sync_status: todo.google_sync_status,
      }))}
      levels={levels.map((level) => ({ rank: level.rank, label: level.label }))}
    />
  );
}
```

`TodoBoard.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type TodoRow = {
  id: string;
  title: string;
  status: string;
  priority_rank: number;
  due_at: string | null;
  planned_date: string;
  category: string | null;
  google_sync_status: string;
};

type Props = {
  initialTodos: TodoRow[];
  levels: Array<{ rank: number; label: string }>;
};

export function TodoBoard({ initialTodos, levels }: Props) {
  const router = useRouter();
  const [todos, setTodos] = useState(initialTodos);
  const [error, setError] = useState('');

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const due = String(form.get('due_at') ?? '');
    const response = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.get('title'),
        category: form.get('category') || null,
        priority_rank: Number(form.get('priority_rank')),
        due_at: due ? new Date(due).toISOString() : null,
        has_specific_time: Boolean(due),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error?.toString() ?? 'Gagal menyimpan.');
      return;
    }
    setError('');
    setTodos((current) => [payload.todo, ...current]);
    router.refresh();
    event.currentTarget.reset();
  }

  async function updateStatus(id: string, status: string) {
    const response = await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setError('Gagal mengubah status.');
      return;
    }
    setTodos((current) => current.map((todo) => (todo.id === id ? { ...todo, status } : todo)));
    router.refresh();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Gagal menghapus.');
      return;
    }
    setTodos((current) => current.filter((todo) => todo.id !== id));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">To-Do</h1>

      <form onSubmit={create} className="grid gap-2 rounded border bg-white p-4 md:grid-cols-6">
        <input name="title" placeholder="Judul tugas" required maxLength={120} className="rounded border p-2 md:col-span-2" />
        <input name="category" placeholder="Kategori" maxLength={40} className="rounded border p-2" />
        <select name="priority_rank" className="rounded border p-2">
          {levels.map((level) => (
            <option key={level.rank} value={level.rank}>{level.rank} · {level.label}</option>
          ))}
        </select>
        <input name="due_at" type="datetime-local" className="rounded border p-2" />
        <button type="submit" className="rounded bg-black p-2 text-white">Tambah</button>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2">Judul</th>
              <th className="p-2">Prioritas</th>
              <th className="p-2">Rencana</th>
              <th className="p-2">Tenggat</th>
              <th className="p-2">Status</th>
              <th className="p-2">Google</th>
              <th className="p-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {todos.map((todo) => (
              <tr key={todo.id} className="border-t">
                <td className="p-2">{todo.title}</td>
                <td className="p-2">{todo.priority_rank}</td>
                <td className="p-2">{todo.planned_date}</td>
                <td className="p-2">{todo.due_at ? new Date(todo.due_at).toLocaleString('id-ID') : '—'}</td>
                <td className="p-2">{todo.status}</td>
                <td className="p-2">{todo.google_sync_status}</td>
                <td className="flex gap-2 p-2">
                  {todo.status !== 'DONE' ? (
                    <button onClick={() => updateStatus(todo.id, 'DONE')} className="text-green-700">Selesai</button>
                  ) : null}
                  {todo.status !== 'CANCELLED' ? (
                    <button onClick={() => updateStatus(todo.id, 'CANCELLED')} className="text-amber-700">Batal</button>
                  ) : null}
                  <button onClick={() => remove(todo.id)} className="text-red-600">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {todos.length === 0 ? <p className="p-4 text-sm text-gray-500">Belum ada tugas.</p> : null}
      </div>
    </div>
  );
}
```

### 4.8 Orders: API dan halaman

`app/api/orders/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const createSchema = z.object({
  customer_name: z.string().min(1).max(150),
  customer_contact: z.string().max(50).nullable().optional(),
  description: z.string().min(1).max(4000),
  event_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_address: z.string().max(2000).nullable().optional(),
  total_amount: z.number().nonnegative().nullable().optional(),
  dp_amount: z.number().nonnegative().nullable().optional(),
  payment_status: z.enum(['UNPAID', 'DP_PAID', 'PAID']).default('UNPAID'),
  notes: z.string().max(4000).nullable().optional(),
});

export async function GET() {
  const orders = await prisma.order.findMany({
    orderBy: { delivery_date: { sort: 'asc', nulls: 'last' } },
    take: 200,
  });
  return NextResponse.json({ ok: true, orders });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
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
      payment_status: input.payment_status,
      notes: input.notes ?? null,
    },
  });
  return NextResponse.json({ ok: true, order });
}
```

`app/api/orders/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const updateSchema = z.object({
  customer_name: z.string().min(1).max(150).optional(),
  customer_contact: z.string().max(50).nullable().optional(),
  description: z.string().min(1).max(4000).optional(),
  event_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_date: z.string().datetime({ offset: true }).nullable().optional(),
  delivery_address: z.string().max(2000).nullable().optional(),
  total_amount: z.number().nonnegative().nullable().optional(),
  dp_amount: z.number().nonnegative().nullable().optional(),
  payment_status: z.enum(['UNPAID', 'DP_PAID', 'PAID']).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const existing = await prisma.order.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ ok: false, error: 'tidak ditemukan' }, { status: 404 });

  const order = await prisma.order.update({
    where: { id: params.id },
    data: {
      customer_name: input.customer_name ?? existing.customer_name,
      customer_contact: input.customer_contact === undefined ? existing.customer_contact : input.customer_contact,
      description: input.description ?? existing.description,
      event_date: input.event_date === undefined ? existing.event_date : input.event_date ? new Date(input.event_date) : null,
      delivery_date: input.delivery_date === undefined ? existing.delivery_date : input.delivery_date ? new Date(input.delivery_date) : null,
      delivery_address: input.delivery_address === undefined ? existing.delivery_address : input.delivery_address,
      total_amount: input.total_amount === undefined ? existing.total_amount : input.total_amount,
      dp_amount: input.dp_amount === undefined ? existing.dp_amount : input.dp_amount,
      payment_status: input.payment_status ?? existing.payment_status,
      notes: input.notes === undefined ? existing.notes : input.notes,
    },
  });
  return NextResponse.json({ ok: true, order });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const deleted = await prisma.order.deleteMany({ where: { id: params.id } });
  if (deleted.count === 0) return NextResponse.json({ ok: false, error: 'tidak ditemukan' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

`app/(app)/orders/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { OrderBoard } from './OrderBoard';

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { delivery_date: { sort: 'asc', nulls: 'last' } },
    take: 200,
  });
  return (
    <OrderBoard
      initialOrders={orders.map((order) => ({
        id: order.id,
        customer_name: order.customer_name,
        description: order.description,
        delivery_date: order.delivery_date?.toISOString() ?? null,
        payment_status: order.payment_status,
        total_amount: order.total_amount ? Number(order.total_amount) : null,
      }))}
    />
  );
}
```

`app/(app)/orders/OrderBoard.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type OrderRow = {
  id: string;
  customer_name: string;
  description: string;
  delivery_date: string | null;
  payment_status: string;
  total_amount: number | null;
};

export function OrderBoard({ initialOrders }: { initialOrders: OrderRow[] }) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [error, setError] = useState('');

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const delivery = String(form.get('delivery_date') ?? '');
    const total = String(form.get('total_amount') ?? '');
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: form.get('customer_name'),
        description: form.get('description'),
        delivery_date: delivery ? new Date(delivery).toISOString() : null,
        payment_status: form.get('payment_status'),
        total_amount: total ? Number(total) : null,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError('Gagal menyimpan pesanan.');
      return;
    }
    setError('');
    setOrders((current) => [payload.order, ...current]);
    event.currentTarget.reset();
    router.refresh();
  }

  async function setPayment(id: string, payment_status: string) {
    const response = await fetch(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status }),
    });
    if (!response.ok) {
      setError('Gagal mengubah pembayaran.');
      return;
    }
    setOrders((current) => current.map((order) => (order.id === id ? { ...order, payment_status } : order)));
    router.refresh();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/orders/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Gagal menghapus pesanan.');
      return;
    }
    setOrders((current) => current.filter((order) => order.id !== id));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Pesanan</h1>

      <form onSubmit={create} className="grid gap-2 rounded border bg-white p-4 md:grid-cols-6">
        <input name="customer_name" placeholder="Nama pelanggan" required className="rounded border p-2" />
        <input name="description" placeholder="Deskripsi pesanan" required className="rounded border p-2 md:col-span-2" />
        <input name="delivery_date" type="datetime-local" className="rounded border p-2" />
        <input name="total_amount" type="number" min="0" step="0.01" placeholder="Total" className="rounded border p-2" />
        <select name="payment_status" className="rounded border p-2">
          <option value="UNPAID">UNPAID</option>
          <option value="DP_PAID">DP_PAID</option>
          <option value="PAID">PAID</option>
        </select>
        <button type="submit" className="rounded bg-black p-2 text-white md:col-span-6">Tambah pesanan</button>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2">Pelanggan</th>
              <th className="p-2">Deskripsi</th>
              <th className="p-2">Kirim</th>
              <th className="p-2">Total</th>
              <th className="p-2">Bayar</th>
              <th className="p-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t">
                <td className="p-2">{order.customer_name}</td>
                <td className="p-2">{order.description}</td>
                <td className="p-2">{order.delivery_date ? new Date(order.delivery_date).toLocaleString('id-ID') : '—'}</td>
                <td className="p-2">{order.total_amount ?? '—'}</td>
                <td className="p-2">
                  <select
                    value={order.payment_status}
                    onChange={(event) => setPayment(order.id, event.target.value)}
                    className="rounded border p-1"
                  >
                    <option value="UNPAID">UNPAID</option>
                    <option value="DP_PAID">DP_PAID</option>
                    <option value="PAID">PAID</option>
                  </select>
                </td>
                <td className="p-2">
                  <button onClick={() => remove(order.id)} className="text-red-600">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 ? <p className="p-4 text-sm text-gray-500">Belum ada pesanan.</p> : null}
      </div>
    </div>
  );
}
```

### 4.9 API Priority Stack

`app/api/priority-levels/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { compileAndStore } from '@/lib/prompt/compiler';

const createSchema = z.object({
  label: z.string().min(1).max(50),
  description: z.string().max(2000).nullable().optional(),
  rule_text: z.string().min(1).max(2000),
  color: z.string().max(20).nullable().optional(),
});

export async function GET() {
  const levels = await prisma.priorityLevel.findMany({ orderBy: { rank: 'asc' } });
  return NextResponse.json({ ok: true, levels });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const highest = await prisma.priorityLevel.findFirst({ orderBy: { rank: 'desc' } });
  const level = await prisma.priorityLevel.create({
    data: {
      rank: (highest?.rank ?? 0) + 1,
      label: parsed.data.label,
      description: parsed.data.description ?? null,
      rule_text: parsed.data.rule_text,
      color: parsed.data.color ?? null,
    },
  });
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  await compileAndStore(prisma as never, settings);
  return NextResponse.json({ ok: true, level });
}
```

`app/api/priority-levels/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { compileAndStore } from '@/lib/prompt/compiler';

const updateSchema = z.object({
  label: z.string().min(1).max(50).optional(),
  description: z.string().max(2000).nullable().optional(),
  rule_text: z.string().min(1).max(2000).optional(),
  color: z.string().max(20).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const level = await prisma.priorityLevel.update({
    where: { id: params.id },
    data: parsed.data,
  });
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  await compileAndStore(prisma as never, settings);
  return NextResponse.json({ ok: true, level });
}

const deleteSchema = z.object({ move_to_rank: z.number().int().min(1).optional() });

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'payload tidak valid' }, { status: 400 });
  }

  const [level, todoCount] = await Promise.all([
    prisma.priorityLevel.findUnique({ where: { id: params.id } }),
    prisma.todo.count({ where: { priority_level_id: params.id } }),
  ]);
  if (!level) return NextResponse.json({ ok: false, error: 'tidak ditemukan' }, { status: 404 });

  if (todoCount > 0) {
    if (!parsed.data.move_to_rank) {
      return NextResponse.json(
        { ok: false, error: 'pindahkan to-do ke tingkat lain terlebih dahulu', todo_count: todoCount },
        { status: 409 },
      );
    }
    const target = await prisma.priorityLevel.findUnique({
      where: { rank: parsed.data.move_to_rank },
    });
    if (!target || target.id === params.id) {
      return NextResponse.json({ ok: false, error: 'move_to_rank tidak valid' }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.todo.updateMany({
        where: { priority_level_id: params.id },
        data: { priority_level_id: target.id, priority_rank: target.rank },
      }),
      prisma.priorityLevel.delete({ where: { id: params.id } }),
    ]);
  } else {
    await prisma.priorityLevel.delete({ where: { id: params.id } });
  }

  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  await compileAndStore(prisma as never, settings);
  return NextResponse.json({ ok: true });
}
```

`app/api/priority-levels/reorder/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { compileAndStore } from '@/lib/prompt/compiler';

const schema = z.object({
  order: z.array(z.string().uuid()).min(1),
});

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'payload tidak valid' }, { status: 400 });
  }

  const existing = await prisma.priorityLevel.findMany();
  if (existing.length !== parsed.data.order.length) {
    return NextResponse.json({ ok: false, error: 'daftar tidak lengkap' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // Fase 1: rank sementara negatif agar tidak melanggar unique(rank).
    for (const [index, id] of parsed.data.order.entries()) {
      await tx.priorityLevel.update({ where: { id }, data: { rank: -(index + 1) } });
    }
    // Fase 2: rank final 1..N.
    for (const [index, id] of parsed.data.order.entries()) {
      await tx.priorityLevel.update({ where: { id }, data: { rank: index + 1 } });
    }
    await tx.todo.updateMany({
      data: { priority_rank: 0 },
    });
    const levels = await tx.priorityLevel.findMany();
    for (const level of levels) {
      await tx.todo.updateMany({
        where: { priority_level_id: level.id },
        data: { priority_rank: level.rank },
      });
    }
  });

  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  const compiled = await compileAndStore(prisma as never, settings);
  return NextResponse.json({ ok: true, warnings: compiled.warnings });
}
```

### 4.10 `app/(app)/priority-stack/page.tsx` dan `StackEditor.tsx`

`page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { StackEditor } from './StackEditor';

export default async function PriorityStackPage() {
  const levels = await prisma.priorityLevel.findMany({ orderBy: { rank: 'asc' } });
  return (
    <StackEditor
      initial={levels.map((level) => ({
        id: level.id,
        rank: level.rank,
        label: level.label,
        description: level.description ?? '',
        rule_text: level.rule_text,
        color: level.color ?? '#2563eb',
      }))}
    />
  );
}
```

`StackEditor.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Level = {
  id: string;
  rank: number;
  label: string;
  description: string;
  rule_text: string;
  color: string;
};

function SortableRow({
  level,
  onChange,
  onSave,
  onDelete,
}: {
  level: Level;
  onChange: (next: Level) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: level.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="grid gap-2 rounded border bg-white p-3 md:grid-cols-12">
      <button {...attributes} {...listeners} className="cursor-grab text-left text-gray-400 md:col-span-1">
        ⠿
      </button>
      <input
        value={level.label}
        onChange={(event) => onChange({ ...level, label: event.target.value })}
        className="rounded border p-2 md:col-span-3"
        placeholder="Label"
      />
      <input
        value={level.rule_text}
        onChange={(event) => onChange({ ...level, rule_text: event.target.value })}
        className="rounded border p-2 md:col-span-5"
        placeholder="Aturan"
      />
      <input
        value={level.description}
        onChange={(event) => onChange({ ...level, description: event.target.value })}
        className="rounded border p-2 md:col-span-2"
        placeholder="Deskripsi"
      />
      <div className="flex items-center gap-2 md:col-span-1">
        <button onClick={onSave} className="text-sm text-blue-700">Simpan</button>
        <button onClick={onDelete} className="text-sm text-red-600">Hapus</button>
      </div>
    </div>
  );
}

export function StackEditor({ initial }: { initial: Level[] }) {
  const router = useRouter();
  const [levels, setLevels] = useState(initial);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function persistOrder(next: Level[]) {
    setLevels(next);
    const response = await fetch('/api/priority-levels/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next.map((level) => level.id) }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError('Gagal menyimpan urutan.');
      return;
    }
    setError('');
    setWarnings(payload.warnings ?? []);
    router.refresh();
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = levels.findIndex((level) => level.id === active.id);
    const newIndex = levels.findIndex((level) => level.id === over.id);
    void persistOrder(arrayMove(levels, oldIndex, newIndex));
  }

  async function save(level: Level) {
    const response = await fetch(`/api/priority-levels/${level.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: level.label,
        description: level.description,
        rule_text: level.rule_text,
        color: level.color,
      }),
    });
    if (!response.ok) {
      setError('Gagal menyimpan tingkat prioritas.');
      return;
    }
    setError('');
    router.refresh();
  }

  async function remove(level: Level) {
    const fallback = levels.find((item) => item.id !== level.id);
    const response = await fetch(`/api/priority-levels/${level.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fallback ? { move_to_rank: fallback.rank } : {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? 'Gagal menghapus tingkat prioritas.');
      return;
    }
    setLevels((current) => current.filter((item) => item.id !== level.id));
    router.refresh();
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/priority-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: form.get('label'),
        description: form.get('description') || null,
        rule_text: form.get('rule_text'),
        color: form.get('color') || null,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError('Gagal menambah tingkat prioritas.');
      return;
    }
    setLevels((current) => [...current, { ...payload.level, description: payload.level.description ?? '', color: payload.level.color ?? '#2563eb' }]);
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Priority Stack</h1>
      <p className="text-sm text-gray-500">
        Urutan dari atas ke bawah menentukan prioritas. Setiap perubahan langsung mengompilasi ulang prompt.
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {warnings.map((warning) => (
        <p key={warning} className="text-sm text-amber-700">{warning}</p>
      ))}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={levels.map((level) => level.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {levels.map((level) => (
              <SortableRow
                key={level.id}
                level={level}
                onChange={(next) => setLevels((current) => current.map((item) => (item.id === next.id ? next : item)))}
                onSave={() => save(level)}
                onDelete={() => remove(level)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <form onSubmit={create} className="grid gap-2 rounded border bg-white p-4 md:grid-cols-4">
        <input name="label" placeholder="Label baru" required className="rounded border p-2" />
        <input name="rule_text" placeholder="Aturan" required className="rounded border p-2 md:col-span-2" />
        <input name="description" placeholder="Deskripsi" className="rounded border p-2" />
        <button type="submit" className="rounded bg-black p-2 text-white md:col-span-4">Tambah tingkat</button>
      </form>
    </div>
  );
}
```

### 4.11 Prompt editor

`app/api/prompt/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { compileSystemPrompt } from '@/lib/prompt/compiler';

const schema = z.object({
  prompt_mode: z.enum(['STACK', 'CUSTOM']),
  custom_prompt_template: z.string().max(40000).nullable().optional(),
});

export async function GET() {
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  return NextResponse.json({
    ok: true,
    prompt_mode: settings.prompt_mode,
    custom_prompt_template: settings.custom_prompt_template,
    compiled_prompt: settings.compiled_prompt,
    compiled_prompt_version: settings.compiled_prompt_version,
    compiled_at: settings.compiled_at,
  });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'payload tidak valid' }, { status: 400 });
  }
  if (parsed.data.prompt_mode === 'CUSTOM' && !parsed.data.custom_prompt_template?.trim()) {
    return NextResponse.json({ ok: false, error: 'template CUSTOM wajib diisi' }, { status: 400 });
  }

  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  const levels = await prisma.priorityLevel.findMany({ orderBy: { rank: 'asc' } });

  let compiled;
  try {
    compiled = compileSystemPrompt(
      {
        ...settings,
        prompt_mode: parsed.data.prompt_mode,
        custom_prompt_template: parsed.data.custom_prompt_template ?? null,
      },
      levels,
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'kompilasi gagal' },
      { status: 400 },
    );
  }

  const updated = await prisma.botSettings.update({
    where: { id: 1 },
    data: {
      prompt_mode: parsed.data.prompt_mode,
      custom_prompt_template: parsed.data.custom_prompt_template ?? null,
      compiled_prompt: compiled.prompt,
      compiled_prompt_version: compiled.version,
      compiled_at: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    warnings: compiled.warnings,
    compiled_prompt: updated.compiled_prompt,
    compiled_prompt_version: updated.compiled_prompt_version,
  });
}
```

`app/api/prompt/preview/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { compileSystemPrompt } from '@/lib/prompt/compiler';
import { renderPrompt } from '@/lib/prompt/render';
import { localIsoString } from '@/lib/time';

const schema = z.object({
  trigger_type: z.enum(['CHAT_MASUK', 'MORNING_BRIEF', 'WORK_HOURS_REMINDER', 'END_OF_DAY_EVAL']),
  custom_prompt_template: z.string().max(40000).nullable().optional(),
  prompt_mode: z.enum(['STACK', 'CUSTOM']).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'payload tidak valid' }, { status: 400 });
  }

  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  const levels = await prisma.priorityLevel.findMany({ orderBy: { rank: 'asc' } });

  const compiled = compileSystemPrompt(
    {
      ...settings,
      prompt_mode: parsed.data.prompt_mode ?? settings.prompt_mode,
      custom_prompt_template:
        parsed.data.custom_prompt_template === undefined
          ? settings.custom_prompt_template
          : parsed.data.custom_prompt_template,
    },
    levels,
  );

  const rows = await prisma.$queryRaw<Array<{ id: string; title: string; priority_rank: number; priority_label: string | null; due_at: Date | null; planned_date: Date; status: string }>>`
    SELECT id, title, priority_rank, priority_label, due_at, planned_date, status
    FROM v_active_todos
    LIMIT 5
  `;

  const sampleContext = {
    current_datetime: localIsoString(new Date(), settings.timezone),
    trigger_type: parsed.data.trigger_type,
    active_todos: rows.map((row) => ({
      id: row.id,
      title: row.title,
      priority_rank: row.priority_rank,
      priority_label: row.priority_label,
      due_at: row.due_at ? localIsoString(row.due_at, settings.timezone) : null,
      planned_date: row.planned_date.toISOString().slice(0, 10),
      status: row.status,
    })),
    daily_stats: {
      target_count: 5,
      done_count: 3,
      pending_count: 2,
      completion_rate: 60,
      tier: 'MID',
    },
    calendar_events_today: [],
    recent_messages: [{ role: 'user', content: 'contoh pesan' }],
  };

  let prompt: string;
  try {
    prompt = renderPrompt(compiled.prompt, parsed.data.trigger_type, sampleContext);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'render gagal' },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, prompt, warnings: compiled.warnings });
}
```

`app/(app)/prompt/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { PromptEditor } from './PromptEditor';

export default async function PromptPage() {
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });
  return (
    <PromptEditor
      initialMode={settings.prompt_mode}
      initialTemplate={settings.custom_prompt_template ?? ''}
      compiledPrompt={settings.compiled_prompt ?? ''}
      version={settings.compiled_prompt_version}
    />
  );
}
```

`app/(app)/prompt/PromptEditor.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  initialMode: 'STACK' | 'CUSTOM';
  initialTemplate: string;
  compiledPrompt: string;
  version: number;
};

export function PromptEditor({ initialMode, initialTemplate, compiledPrompt, version }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [template, setTemplate] = useState(initialTemplate);
  const [previewTrigger, setPreviewTrigger] = useState('CHAT_MASUK');
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  async function save() {
    const response = await fetch('/api/prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_mode: mode, custom_prompt_template: template || null }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? 'Gagal menyimpan.');
      return;
    }
    setMessage(`Tersimpan. Versi prompt: ${payload.compiled_prompt_version}`);
    setWarnings(payload.warnings ?? []);
    router.refresh();
  }

  async function runPreview() {
    const response = await fetch('/api/prompt/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_type: previewTrigger,
        prompt_mode: mode,
        custom_prompt_template: template || null,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setPreview(payload.error ?? 'Gagal render.');
      return;
    }
    setPreview(payload.prompt);
    setWarnings(payload.warnings ?? []);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Prompt</h1>
      <p className="text-sm text-gray-500">Versi terkompilasi saat ini: {version}</p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === 'STACK'} onChange={() => setMode('STACK')} />
          STACK (otomatis dari Priority Stack)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === 'CUSTOM'} onChange={() => setMode('CUSTOM')} />
          CUSTOM
        </label>
      </div>

      <textarea
        value={mode === 'CUSTOM' ? template : compiledPrompt}
        onChange={(event) => setTemplate(event.target.value)}
        readOnly={mode !== 'CUSTOM'}
        rows={18}
        className="w-full rounded border p-3 font-mono text-xs"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} className="rounded bg-black px-4 py-2 text-white">Simpan dan kompilasi</button>
        <select value={previewTrigger} onChange={(event) => setPreviewTrigger(event.target.value)} className="rounded border p-2">
          <option value="CHAT_MASUK">CHAT_MASUK</option>
          <option value="MORNING_BRIEF">MORNING_BRIEF</option>
          <option value="WORK_HOURS_REMINDER">WORK_HOURS_REMINDER</option>
          <option value="END_OF_DAY_EVAL">END_OF_DAY_EVAL</option>
        </select>
        <button onClick={runPreview} className="rounded border px-4 py-2">Pratinjau</button>
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {warnings.map((warning) => (
        <p key={warning} className="text-sm text-amber-700">{warning}</p>
      ))}

      {preview ? (
        <pre className="max-h-96 overflow-auto rounded border bg-white p-3 text-xs">{preview}</pre>
      ) : null}
    </div>
  );
}
```

## 5. Definition of Done

```bash
cd dashboard && npm run build        # tipe dan lint lolos
cd .. && docker compose up -d --build
```

Skenario manual (browser `http://127.0.0.1:3000`):

1. Login → dashboard menampilkan ringkasan dan 3 fokus kosong.
2. `/todos` → tambah tugas "Antar buket Bu Ani", prioritas 1, tenggat besok 10:00.
   - Verifikasi DB:
     ```bash
     docker exec botseri-db psql -U botseri -d botseri -c \
       "SELECT title, priority_rank, planned_date, due_at, status FROM todos ORDER BY created_at DESC LIMIT 1;"
     ```
   - `planned_date` sama dengan tanggal lokal tenggat.
3. Tandai selesai → `status = DONE`, `completed_at` terisi.
4. `/priority-stack` → ubah urutan; setelah refresh urutan bertahan dan `bot_settings.compiled_prompt_version` naik:
   ```bash
   docker exec botseri-db psql -U botseri -d botseri -c \
     "SELECT compiled_prompt_version, compiled_at FROM bot_settings;"
   ```
5. Ubah label tingkat → `compiled_prompt` memuat label baru:
   ```bash
   docker exec botseri-db psql -U botseri -d botseri -tAc \
     "SELECT compiled_prompt LIKE '%Kritis%' FROM bot_settings;"
   ```
6. `/prompt` → pilih CUSTOM, isi placeholder tidak dikenal `{{foo}}`, simpan → ditolak 400.
7. Pratinjau `MORNING_BRIEF` → tidak ada `{{...}}` tersisa dan hanya blok trigger MORNING_BRIEF yang muncul.
8. `/orders` → tambah pesanan, ubah status pembayaran, hapus.

Kriteria lulus:

- `npm run build` sukses tanpa error TypeScript.
- Seluruh operasi CRUD bertahan setelah refresh.
- Reorder prioritas tidak melanggar unique(rank) dan mengompilasi prompt.
- Penghapusan tingkat prioritas yang masih dipakai meminta `move_to_rank`.
- Pratinjau prompt tidak memuat placeholder runtime yang belum terisi.
