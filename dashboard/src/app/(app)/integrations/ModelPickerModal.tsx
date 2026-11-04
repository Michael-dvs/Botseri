"use client";

import { useId, useMemo, useState } from "react";
import type { UnifiedModelCatalogItem } from "@/lib/llm-gateway/catalog";

export type FilterCategory =
  | "ALL"
  | "CHAT"
  | "VISION"
  | "AUDIO"
  | "FREE"
  | "REASONING";

interface ModelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: UnifiedModelCatalogItem[];
  selectedProvider: string;
  onSelectModel: (model: UnifiedModelCatalogItem) => void;
  isLoading?: boolean;
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}m ctx`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}k ctx`;
  }
  return `${tokens} ctx`;
}

function formatPricing(pricing: UnifiedModelCatalogItem["pricing"]): string {
  if (pricing.is_free) return "GRATIS";
  const inPrice =
    pricing.input_per_mtok_usd < 0.01
      ? pricing.input_per_mtok_usd.toFixed(4)
      : pricing.input_per_mtok_usd.toFixed(2);
  const outPrice =
    pricing.output_per_mtok_usd < 0.01
      ? pricing.output_per_mtok_usd.toFixed(4)
      : pricing.output_per_mtok_usd.toFixed(2);
  return `$${inPrice} / $${outPrice}`;
}

export function ModelPickerModal({
  isOpen,
  onClose,
  models,
  selectedProvider,
  onSelectModel,
  isLoading = false,
}: ModelPickerModalProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<FilterCategory>("ALL");
  const headingId = useId();

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();

    return models.filter((item) => {
      // Filter kategori
      if (category === "FREE" && !item.pricing.is_free) return false;
      if (category === "VISION" && !item.capabilities.vision) return false;
      if (category === "AUDIO" && !item.capabilities.audio_stt) return false;
      if (category === "REASONING" && !item.capabilities.reasoning) return false;
      if (category === "CHAT") {
        if (item.capabilities.reasoning) return false;
      }

      // Filter pencarian teks
      if (!query) return true;
      const matchId = item.id.toLowerCase().includes(query);
      const matchName = item.name.toLowerCase().includes(query);
      const matchDesc = item.description?.toLowerCase().includes(query) ?? false;
      return matchId || matchName || matchDesc;
    });
  }, [models, search, category]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="panel flex flex-col w-full max-w-4xl max-h-[90vh] bg-[var(--surface)] border border-[var(--line)] shadow-2xl rounded-xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header Modal */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-4 bg-[var(--paper)]">
          <div>
            <div className="flex items-center gap-2">
              <span className="eyebrow text-[var(--accent)] font-mono">
                {selectedProvider}
              </span>
              <span className="text-xs text-[var(--muted)]">·</span>
              <span className="text-xs text-[var(--muted)]">
                {models.length} model terindeks
              </span>
            </div>
            <h2 id={headingId} className="text-lg font-semibold tracking-tight text-[var(--ink)]">
              Katalog Model & Otomatisasi Metadata
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-quiet min-h-[44px] min-w-[44px] px-3 text-sm font-mono text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Tutup katalog"
          >
            [ESC / Tutup]
          </button>
        </div>

        {/* Toolbar: Input Pencarian & Kategori Filter */}
        <div className="flex flex-col gap-3 p-4 border-b border-[var(--line)] bg-[var(--surface)]">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari model berdasarkan nama, id (contoh: gpt-4o, flash, claude, r1), atau kapabilitas..."
              className="field w-full pl-9 font-mono text-sm min-h-[44px]"
              autoFocus
            />
            <span
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] font-mono text-sm"
            >
              &gt;
            </span>
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-[var(--muted)] hover:text-[var(--ink)] px-2 py-1"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick Filters Utilitarian */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <span className="text-[var(--muted)] mr-1 font-mono text-[11px]">Filter:</span>
            {(
              [
                { id: "ALL", label: "Semua" },
                { id: "CHAT", label: "Chat" },
                { id: "VISION", label: "Vision" },
                { id: "AUDIO", label: "Audio / STT" },
                { id: "FREE", label: "Gratis (Free)" },
                { id: "REASONING", label: "Reasoning" },
              ] as const
            ).map((item) => {
              const active = category === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  className={`min-h-[44px] sm:min-h-[32px] px-3 py-1.5 rounded border transition-colors ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)] font-semibold"
                      : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
            <span className="ml-auto text-[11px] font-mono text-[var(--muted)]">
              {filteredModels.length} hasil
            </span>
          </div>
        </div>

        {/* List Model Scannable */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--line)] bg-[var(--surface)] p-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-sm text-[var(--muted)]">
              <span className="animate-pulse font-mono text-base font-semibold text-[var(--accent)]">
                Menarik katalog model dari provider...
              </span>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Memproses metadata konteks, kapabilitas, dan tarif token.
              </p>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-sm text-[var(--muted)]">
              <span className="font-mono text-base font-semibold text-[var(--ink)]">
                Tidak ada model yang cocok
              </span>
              <p className="mt-1 text-xs text-[var(--muted)] max-w-sm">
                Coba sesuaikan kata kunci pencarian atau ubah filter kategori.
              </p>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="btn btn-secondary mt-3 text-xs"
                >
                  Reset Pencarian
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredModels.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    onSelectModel(item);
                    onClose();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectModel(item);
                      onClose();
                    }
                  }}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-transparent hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] cursor-pointer transition-all min-h-[44px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-[var(--ink)] group-hover:text-[var(--accent-strong)]">
                        {item.id}
                      </span>
                      {item.name !== item.id && (
                        <span className="text-xs text-[var(--muted)] font-medium">
                          ({item.name})
                        </span>
                      )}
                    </div>

                    {item.description && (
                      <p className="mt-0.5 text-xs text-[var(--muted)] line-clamp-1">
                        {item.description}
                      </p>
                    )}

                    {/* Badges Baris Bawah */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--muted)] border border-[var(--line)]">
                        {formatContext(item.context_length)}
                      </span>
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--muted)] border border-[var(--line)]">
                        max out {formatContext(item.max_output_tokens)}
                      </span>

                      {item.capabilities.vision && (
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800 font-medium">
                          Vision
                        </span>
                      )}
                      {item.capabilities.function_calling && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 font-medium">
                          Tools
                        </span>
                      )}
                      {item.capabilities.audio_stt && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-800 font-medium">
                          Audio
                        </span>
                      )}
                      {item.capabilities.reasoning && (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800 font-medium">
                          Reasoning
                        </span>
                      )}
                      {item.recommended_stt_model && (
                        <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--muted)]">
                          STT: {item.recommended_stt_model}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Kolom Harga & Tombol Aksi */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-[var(--line)]">
                    <span
                      className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${
                        item.pricing.is_free
                          ? "bg-[var(--success-soft)] text-[var(--success)]"
                          : "text-[var(--ink)] bg-[var(--paper)]"
                      }`}
                    >
                      {formatPricing(item.pricing)}
                    </span>
                    <span className="text-[11px] text-[var(--muted)] font-mono sm:mt-1">
                      in / out per 1M
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3 bg-[var(--paper)] text-xs text-[var(--muted)]">
          <span>
            Klik model untuk mengisi otomatis seluruh kolom formulir konfigurasi.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary min-h-[44px] sm:min-h-[32px] text-xs font-mono"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
