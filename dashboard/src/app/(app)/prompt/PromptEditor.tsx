"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PromptMode = "STACK" | "CUSTOM";
type Trigger =
  | "CHAT_MASUK"
  | "MORNING_BRIEF"
  | "WORK_HOURS_REMINDER"
  | "END_OF_DAY_EVAL";

const triggers: Array<{ value: Trigger; label: string }> = [
  { value: "CHAT_MASUK", label: "Chat masuk" },
  { value: "MORNING_BRIEF", label: "Morning brief" },
  { value: "WORK_HOURS_REMINDER", label: "Pengingat jam kerja" },
  { value: "END_OF_DAY_EVAL", label: "Evaluasi akhir hari" },
];

export function PromptEditor({
  initialMode,
  initialTemplate,
  compiledPrompt,
  version,
}: {
  initialMode: PromptMode;
  initialTemplate: string;
  compiledPrompt: string;
  version: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<PromptMode>(initialMode);
  const [template, setTemplate] = useState(initialTemplate);
  const [currentCompiled, setCurrentCompiled] = useState(compiledPrompt);
  const [currentVersion, setCurrentVersion] = useState(version);
  const [previewTrigger, setPreviewTrigger] =
    useState<Trigger>("CHAT_MASUK");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, setPending] = useState<"save" | "preview" | null>(null);

  async function save() {
    if (mode === "CUSTOM" && !template.trim()) {
      setError("Template CUSTOM wajib diisi.");
      return;
    }

    setPending("save");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_mode: mode,
          custom_prompt_template: template || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal menyimpan prompt.",
        );
        return;
      }
      setCurrentCompiled(payload.compiled_prompt ?? "");
      setCurrentVersion(payload.compiled_prompt_version ?? currentVersion);
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
      setMessage(
        `Tersimpan. Versi prompt: ${payload.compiled_prompt_version}.`,
      );
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  async function runPreview() {
    if (mode === "CUSTOM" && !template.trim()) {
      setError("Template CUSTOM wajib diisi.");
      return;
    }

    setPending("preview");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/prompt/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger_type: previewTrigger,
          prompt_mode: mode,
          custom_prompt_template: template || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setPreview("");
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Gagal membuat pratinjau.",
        );
        return;
      }
      setPreview(payload.prompt ?? "");
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-3xl">
        <p className="eyebrow">Kontrol perilaku</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Prompt
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Mode STACK mengikuti urutan Priority Stack. Mode CUSTOM memakai
          template sendiri. Setiap simpan mengompilasi prompt dan menaikkan
          versi.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <section className="panel p-4 sm:p-5" aria-labelledby="editor-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="editor-heading" className="text-lg font-semibold">
              Editor
            </h2>
            <span className="badge">Versi aktif: v{currentVersion}</span>
          </div>

          <fieldset className="mt-4">
            <legend className="eyebrow">Mode prompt</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: "STACK" as const,
                    title: "STACK",
                    description: "Otomatis dari Priority Stack.",
                  },
                  {
                    value: "CUSTOM" as const,
                    title: "CUSTOM",
                    description: "Template Anda sendiri.",
                  },
                ] satisfies Array<{
                  value: PromptMode;
                  title: string;
                  description: string;
                }>
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-16 cursor-pointer items-start gap-3 rounded border p-3 ${
                    mode === option.value
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] bg-[var(--surface)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="prompt_mode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {option.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="field-label mt-4">
            {mode === "CUSTOM" ? "Template CUSTOM" : "Prompt terkompilasi"}
            <textarea
              value={mode === "CUSTOM" ? template : currentCompiled}
              onChange={(event) => setTemplate(event.target.value)}
              readOnly={mode !== "CUSTOM"}
              rows={20}
              spellCheck={false}
              className="field resize-y font-mono text-xs leading-5"
              placeholder={
                mode === "CUSTOM"
                  ? "Tulis template. Gunakan {{brand_name}} dan {{compiled_priority_stack}}."
                  : ""
              }
            />
          </label>

          {mode === "CUSTOM" ? (
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Placeholder yang tersedia: brand_name, business_type, timezone,
              work_hours_start, work_hours_end, early_brief_time,
              behavior_mode, behavior_instruction, compiled_priority_stack.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending !== null}
              className="btn btn-primary"
            >
              {pending === "save" ? "Menyimpan..." : "Simpan dan kompilasi"}
            </button>
            <label className="field-label min-w-44">
              Trigger pratinjau
              <select
                value={previewTrigger}
                onChange={(event) =>
                  setPreviewTrigger(event.target.value as Trigger)
                }
                className="field"
              >
                {triggers.map((trigger) => (
                  <option key={trigger.value} value={trigger.value}>
                    {trigger.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={runPreview}
              disabled={pending !== null}
              className="btn btn-secondary self-end"
            >
              {pending === "preview" ? "Menyiapkan..." : "Pratinjau"}
            </button>
          </div>
        </section>

        <section className="panel p-4 sm:p-5" aria-labelledby="preview-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="preview-heading" className="text-lg font-semibold">
              Pratinjau
            </h2>
            <span className="badge">{previewTrigger}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Memakai data tugas aktif dan statistik hari ini dari database.
          </p>

          {preview ? (
            <pre className="mt-4 max-h-[34rem] overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--line)] bg-[var(--surface-muted)] p-3 font-mono text-xs leading-5">
              {preview}
            </pre>
          ) : (
            <div className="mt-4 rounded border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
              Pilih trigger lalu tekan Pratinjau.
            </div>
          )}
        </section>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
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
      </div>
    </div>
  );
}
