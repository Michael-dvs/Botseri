"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  position,
  busy,
  onChange,
  onSave,
  onDelete,
}: {
  level: Level;
  position: number;
  busy: boolean;
  onChange: (next: Level) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: level.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`panel p-3 sm:p-4 ${
        isDragging ? "relative z-10 opacity-80" : ""
      }`}
    >
      <div className="grid gap-3 md:grid-cols-12">
        <div className="flex items-start gap-3 md:col-span-1">
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Geser prioritas ${level.label}`}
            className="btn btn-secondary size-11 shrink-0 cursor-grab touch-none px-0 active:cursor-grabbing"
          >
            <span aria-hidden="true" className="font-mono text-base">
              ⠿
            </span>
          </button>
          <span className="font-mono text-sm font-semibold text-[var(--accent)]">
            {String(position + 1).padStart(2, "0")}
          </span>
        </div>

        <label className="field-label md:col-span-3">
          Label
          <input
            value={level.label}
            maxLength={50}
            onChange={(event) =>
              onChange({ ...level, label: event.target.value })
            }
            className="field"
            placeholder="Contoh: Kritis"
          />
        </label>

        <label className="field-label md:col-span-4">
          Aturan
          <input
            value={level.rule_text}
            maxLength={2000}
            onChange={(event) =>
              onChange({ ...level, rule_text: event.target.value })
            }
            className="field"
            placeholder="Kapan prioritas ini dipakai"
          />
        </label>

        <label className="field-label md:col-span-2">
          Deskripsi
          <input
            value={level.description}
            maxLength={2000}
            onChange={(event) =>
              onChange({ ...level, description: event.target.value })
            }
            className="field"
            placeholder="Opsional"
          />
        </label>

        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
          <label className="field-label">
            Warna
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(level.color) ? level.color : "#9a3412"}
              onChange={(event) =>
                onChange({ ...level, color: event.target.value })
              }
              aria-label={`Warna prioritas ${level.label}`}
              className="h-11 w-14 cursor-pointer rounded border border-[var(--line)] bg-[var(--surface)] p-1"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="btn btn-secondary"
          >
            Simpan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="btn btn-danger"
          >
            Hapus
          </button>
        </div>
      </div>
    </li>
  );
}

export function StackEditor({ initial }: { initial: Level[] }) {
  const router = useRouter();
  const [levels, setLevels] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    setLevels(initial);
  }, [initial]);

  async function persistOrder(next: Level[]) {
    const previous = levels;
    setLevels(next);
    setPending("reorder");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/priority-levels/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((level) => level.id) }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setLevels(previous);
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menyimpan urutan.",
        );
        return;
      }
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
      setMessage("Urutan disimpan dan prompt dikompilasi ulang.");
      router.refresh();
    } catch {
      setLevels(previous);
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || pending === "reorder") return;
    const oldIndex = levels.findIndex((level) => level.id === active.id);
    const newIndex = levels.findIndex((level) => level.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    void persistOrder(arrayMove(levels, oldIndex, newIndex));
  }

  async function save(level: Level) {
    setPending(level.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/priority-levels/${level.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: level.label,
          description: level.description || null,
          rule_text: level.rule_text,
          color: level.color || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menyimpan tingkat prioritas.",
        );
        return;
      }
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
      setMessage("Tingkat prioritas disimpan dan prompt dikompilasi ulang.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  async function remove(level: Level) {
    const fallback = levels.find((item) => item.id !== level.id);
    if (
      !window.confirm(
        fallback
          ? `Hapus "${level.label}"? To-do terkait akan dipindahkan ke "${fallback.label}".`
          : `Hapus "${level.label}"?`,
      )
    ) {
      return;
    }

    setPending(level.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/priority-levels/${level.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          fallback ? { move_to_rank: fallback.rank } : {},
        ),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menghapus tingkat prioritas.",
        );
        return;
      }
      setLevels((current) => current.filter((item) => item.id !== level.id));
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
      setMessage("Tingkat prioritas dihapus dan prompt dikompilasi ulang.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending("create");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/priority-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: String(form.get("label") ?? "").trim(),
          description: String(form.get("description") ?? "").trim() || null,
          rule_text: String(form.get("rule_text") ?? "").trim(),
          color: String(form.get("color") ?? "") || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menambah tingkat prioritas.",
        );
        return;
      }
      const created = payload.level as Level;
      setLevels((current) => [
        ...current,
        {
          ...created,
          description: created.description ?? "",
          color: created.color ?? "#9a3412",
        },
      ]);
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
      setMessage("Tingkat prioritas ditambahkan dan prompt dikompilasi ulang.");
      formElement.reset();
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-3xl">
        <p className="eyebrow">Urutan kerja</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Priority Stack
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Urutan dari atas ke bawah menentukan prioritas. Setiap perubahan
          langsung mengompilasi ulang prompt. Tarik handle atau fokuskan handle
          lalu tekan Space dan panah untuk memindahkan kartu.
        </p>
      </header>

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
      {warnings.map((warning) => (
        <p
          key={warning}
          className="rounded border border-[#e7c9a5] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]"
        >
          {warning}
        </p>
      ))}

      <section aria-busy={pending !== null} aria-live="polite">
        {levels.length === 0 ? (
          <div className="panel p-8 text-center">
            <p className="font-medium">Belum ada tingkat prioritas.</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Tambahkan tingkat pertama di form bawah.
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={levels.map((level) => level.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="flex flex-col gap-2">
                {levels.map((level, index) => (
                  <SortableRow
                    key={level.id}
                    level={level}
                    position={index}
                    busy={pending === level.id || pending === "reorder"}
                    onChange={(next) =>
                      setLevels((current) =>
                        current.map((item) =>
                          item.id === next.id ? next : item,
                        ),
                      )
                    }
                    onSave={() => save(level)}
                    onDelete={() => remove(level)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <form
        onSubmit={create}
        className="panel p-4 sm:p-5"
        aria-label="Tambah tingkat prioritas"
      >
        <div className="grid gap-3 md:grid-cols-12">
          <label className="field-label md:col-span-3">
            Label baru
            <input
              name="label"
              required
              maxLength={50}
              className="field"
              placeholder="Contoh: Klien VIP"
            />
          </label>
          <label className="field-label md:col-span-5">
            Aturan
            <input
              name="rule_text"
              required
              maxLength={2000}
              className="field"
              placeholder="Kapan prioritas ini dipakai"
            />
          </label>
          <label className="field-label md:col-span-3">
            Deskripsi
            <input
              name="description"
              maxLength={2000}
              className="field"
              placeholder="Opsional"
            />
          </label>
          <label className="field-label md:col-span-1">
            Warna
            <input
              name="color"
              type="color"
              defaultValue="#9a3412"
              className="h-11 w-full cursor-pointer rounded border border-[var(--line)] bg-[var(--surface)] p-1"
            />
          </label>
          <div className="md:col-span-12">
            <button
              type="submit"
              disabled={pending === "create"}
              className="btn btn-primary"
            >
              {pending === "create" ? "Menambahkan..." : "Tambah tingkat"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
