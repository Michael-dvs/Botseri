"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatLocalDateTime,
  localDateTimeInputToUtc,
} from "@/lib/time";

type TodoStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";

type TodoRow = {
  id: string;
  title: string;
  status: TodoStatus;
  priority_rank: number;
  due_at: string | null;
  planned_date: string;
  category: string | null;
  google_sync_status: string;
  completed_at: string | null;
};

type ServerTodo = Omit<TodoRow, "due_at" | "planned_date" | "completed_at"> & {
  due_at: string | null;
  planned_date: string;
  completed_at: string | null;
};

type Level = { rank: number; label: string; color: string | null };
type Filter = "ALL" | TodoStatus;

const filters: Array<{ value: Filter; label: string }> = [
  { value: "ALL", label: "Semua" },
  { value: "PENDING", label: "Menunggu" },
  { value: "IN_PROGRESS", label: "Dikerjakan" },
  { value: "DONE", label: "Selesai" },
  { value: "CANCELLED", label: "Dibatalkan" },
];

const statusLabels: Record<TodoStatus, string> = {
  PENDING: "Menunggu",
  IN_PROGRESS: "Dikerjakan",
  DONE: "Selesai",
  CANCELLED: "Dibatalkan",
};

const googleLabels: Record<string, string> = {
  NOT_REQUIRED: "Tidak perlu",
  PENDING: "Menunggu",
  SYNCED: "Tersinkron",
  FAILED: "Gagal",
};

function statusBadge(status: TodoStatus) {
  if (status === "DONE") return "badge badge-success";
  if (status === "CANCELLED") return "badge badge-danger";
  if (status === "IN_PROGRESS") return "badge badge-warning";
  return "badge";
}

function normalizeTodo(todo: ServerTodo): TodoRow {
  return {
    ...todo,
    due_at: todo.due_at,
    planned_date: todo.planned_date.slice(0, 10),
    completed_at: todo.completed_at,
  };
}

export function TodoBoard({
  initialTodos,
  levels,
  timezone,
  today,
}: {
  initialTodos: TodoRow[];
  levels: Level[];
  timezone: string;
  today: string;
}) {
  const router = useRouter();
  const [todos, setTodos] = useState(initialTodos);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setTodos(initialTodos);
  }, [initialTodos]);

  const filtered =
    filter === "ALL" ? todos : todos.filter((todo) => todo.status === filter);
  const activeCount = todos.filter(
    (todo) => todo.status === "PENDING" || todo.status === "IN_PROGRESS",
  ).length;

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const due = String(form.get("due_at") ?? "");
    const title = String(form.get("title") ?? "").trim();
    if (!title) {
      setError("Judul tugas wajib diisi.");
      return;
    }

    let dueAt: string | null = null;
    if (due) {
      const converted = localDateTimeInputToUtc(due, timezone);
      if (Number.isNaN(converted.getTime())) {
        setError("Tenggat tidak valid.");
        return;
      }
      dueAt = converted.toISOString();
    }

    setPending("create");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category: String(form.get("category") ?? "").trim() || null,
          priority_rank: Number(form.get("priority_rank")),
          due_at: dueAt,
          has_specific_time: Boolean(due),
          planned_date: due ? undefined : today,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menyimpan tugas.",
        );
        return;
      }
      setTodos((current) => [
        normalizeTodo(payload.todo as ServerTodo),
        ...current,
      ]);
      setMessage("Tugas ditambahkan.");
      formElement.reset();
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  async function updateStatus(id: string, status: TodoStatus) {
    setPending(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal mengubah status.",
        );
        return;
      }
      const updated = normalizeTodo(payload.todo as ServerTodo);
      setTodos((current) =>
        current.map((todo) => (todo.id === id ? updated : todo)),
      );
      setMessage(`Status diubah menjadi ${statusLabels[status]}.`);
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  async function remove(todo: TodoRow) {
    if (!window.confirm(`Hapus tugas "${todo.title}"?`)) return;
    setPending(todo.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menghapus tugas.",
        );
        return;
      }
      setTodos((current) => current.filter((item) => item.id !== todo.id));
      setMessage("Tugas dihapus.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Papan operasional</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">To-Do</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {activeCount} tugas aktif dari {todos.length} tugas terakhir.
          </p>
        </div>
        <p className="badge">Rencana hari ini: {today}</p>
      </header>

      <form onSubmit={create} className="panel p-4 sm:p-5" aria-label="Tambah tugas">
        <div className="grid gap-3 md:grid-cols-12">
          <label className="field-label md:col-span-4">
            Judul tugas
            <input
              name="title"
              required
              maxLength={120}
              className="field"
              placeholder="Contoh: Antar buket Bu Ani"
            />
          </label>
          <label className="field-label md:col-span-2">
            Kategori
            <input
              name="category"
              maxLength={40}
              className="field"
              placeholder="Pengiriman"
            />
          </label>
          <label className="field-label md:col-span-2">
            Prioritas
            <select name="priority_rank" className="field">
              {levels.map((level) => (
                <option key={level.rank} value={level.rank}>
                  {level.rank} · {level.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label md:col-span-3">
            Tenggat
            <input name="due_at" type="datetime-local" className="field" />
          </label>
          <div className="flex items-end md:col-span-1">
            <button
              type="submit"
              disabled={pending === "create" || levels.length === 0}
              className="btn btn-primary w-full"
            >
              {pending === "create" ? "Menyimpan..." : "Tambah"}
            </button>
          </div>
        </div>
        {levels.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--warning)]">
            Belum ada tingkat prioritas. Tambahkan di Priority Stack.
          </p>
        ) : null}
      </form>

      {error ? (
        <p
          role="alert"
          className="rounded border border-[#e7c3be] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded border border-[#c7d5ad] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]"
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1" aria-label="Filter status">
        {filters.map((item) => {
          const count =
            item.value === "ALL"
              ? todos.length
              : todos.filter((todo) => todo.status === item.value).length;
          const active = filter === item.value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(item.value)}
              className={`btn btn-quiet ${
                active ? "bg-[var(--surface)] text-[var(--ink)]" : ""
              }`}
            >
              {item.label}
              <span className="font-mono text-xs text-[var(--muted)]">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="panel overflow-hidden"
        aria-busy={pending !== null}
        aria-live="polite"
      >
        <div className="board-grid board-head border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2.5">
          <span className="eyebrow">Tugas</span>
          <span className="eyebrow">Prioritas</span>
          <span className="eyebrow">Rencana</span>
          <span className="eyebrow">Status</span>
          <span className="eyebrow">Aksi</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-medium">
              {todos.length === 0
                ? "Belum ada tugas."
                : "Tidak ada tugas dengan filter ini."}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {todos.length === 0
                ? "Mulai dari form di atas."
                : "Pilih Semua untuk melihat seluruh papan."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {filtered.map((todo) => {
              const level = levels.find(
                (item) => item.rank === todo.priority_rank,
              );
              const busy = pending === todo.id;
              return (
                <li key={todo.id} className="board-grid board-row px-4 py-3">
                  <div className="board-cell min-w-0">
                    <span className="cell-label">Tugas</span>
                    <div className="cell-value min-w-0">
                      <p className="font-medium leading-5">{todo.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {todo.category ?? "Tanpa kategori"} ·{" "}
                        {googleLabels[todo.google_sync_status] ?? todo.google_sync_status}
                      </p>
                    </div>
                  </div>

                  <div className="board-cell">
                    <span className="cell-label">Prioritas</span>
                    <div className="cell-value flex items-center gap-2">
                      {level?.color ? (
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{ backgroundColor: level.color }}
                        />
                      ) : null}
                      <span className="text-sm">
                        {todo.priority_rank} · {level?.label ?? "Tanpa label"}
                      </span>
                    </div>
                  </div>

                  <div className="board-cell">
                    <span className="cell-label">Rencana</span>
                    <div className="cell-value">
                      <p className="text-sm">{todo.planned_date}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {todo.due_at
                          ? formatLocalDateTime(todo.due_at, timezone)
                          : "Tanpa jam"}
                      </p>
                    </div>
                  </div>

                  <div className="board-cell">
                    <span className="cell-label">Status</span>
                    <div className="cell-value">
                      <span className={statusBadge(todo.status)}>
                        {statusLabels[todo.status]}
                      </span>
                      {todo.completed_at ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {formatLocalDateTime(todo.completed_at, timezone)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="board-cell">
                    <span className="cell-label">Aksi</span>
                    <div className="cell-value flex flex-wrap justify-end gap-1">
                      {todo.status !== "DONE" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => updateStatus(todo.id, "DONE")}
                          className="btn btn-quiet text-[var(--success)]"
                        >
                          Selesai
                        </button>
                      ) : null}
                      {todo.status !== "CANCELLED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => updateStatus(todo.id, "CANCELLED")}
                          className="btn btn-quiet text-[var(--warning)]"
                        >
                          Batalkan
                        </button>
                      ) : null}
                      {todo.status === "DONE" ||
                      todo.status === "CANCELLED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => updateStatus(todo.id, "PENDING")}
                          className="btn btn-quiet"
                        >
                          Buka
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(todo)}
                        className="btn btn-quiet text-[var(--danger)]"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
