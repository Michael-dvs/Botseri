"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ModelPickerModal } from "./ModelPickerModal";
import { AuthorizedNumbersList, type AuthorizedNumberItem } from "./AuthorizedNumbersList";
import type { UnifiedModelCatalogItem } from "@/lib/llm-gateway/catalog";

type LlmConfig = {
  id: string;
  provider: string;
  model: string;
  base_url: string | null;
  stt_model: string | null;
  is_active: boolean;
  is_fallback?: boolean;
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

const providers = [
  { value: "OPENAI", label: "OpenAI" },
  { value: "OPENROUTER", label: "OpenRouter" },
  { value: "GEMINI", label: "Google Gemini" },
  { value: "CUSTOM_OPENAI_COMPAT", label: "Custom OpenAI Compatible" },
  { value: "ANTHROPIC", label: "Anthropic Claude" },
] as const;

function apiKeyPlaceholder(provider: string): string {
  switch (provider) {
    case "OPENROUTER":
      return "sk-or-v1-...";
    case "OPENAI":
      return "sk-proj-...";
    case "GEMINI":
      return "AIzaSy...";
    case "ANTHROPIC":
      return "sk-ant-api03-...";
    case "CUSTOM_OPENAI_COMPAT":
      return "sk-... atau token kustom";
    default:
      return "sk-...";
  }
}

function wahaBadge(status: string) {
  if (status === "WORKING") return { label: "Terhubung", cls: "badge badge-success" };
  if (status === "SCAN_QR_CODE") return { label: "Menunggu Pindai QR", cls: "badge badge-warning" };
  if (status === "STARTING") return { label: "Memulai Sesi...", cls: "badge" };
  if (status === "STOPPED") return { label: "Sesi Nonaktif", cls: "badge badge-danger" };
  if (status === "FAILED") return { label: "Koneksi Gagal", cls: "badge badge-danger" };
  return { label: status, cls: "badge" };
}

function googleBadgeClass(status: string) {
  if (status === "CONNECTED") return "badge badge-success";
  if (status === "NEEDS_REAUTH") return "badge badge-warning";
  return "badge";
}

export function IntegrationsPanel({
  initialConfigs,
  google,
  initialWahaStatus,
  oauthRedirectUri,
  initialAuthorizedNumbers = [],
  timezone = "Asia/Jakarta",
}: {
  initialConfigs: LlmConfig[];
  google: GoogleInfo;
  initialWahaStatus: string;
  oauthRedirectUri: string;
  initialAuthorizedNumbers?: AuthorizedNumberItem[];
  timezone?: string;
}) {
  const router = useRouter();
  const [configs, setConfigs] = useState<LlmConfig[]>(initialConfigs);
  const [wahaStatus, setWahaStatus] = useState(initialWahaStatus);
  const [pairingCode, setPairingCode] = useState("");
  const [qrKey, setQrKey] = useState(Date.now());
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Phone linking state (WAHA request-code)
  const [waPhone, setWaPhone] = useState("");
  const [waLinkCode, setWaLinkCode] = useState("");
  const [showPhoneLinking, setShowPhoneLinking] = useState(false);

  // Form states
  const [selectedProvider, setSelectedProvider] = useState<string>("OPENAI");
  const [googleClient, setGoogleClient] = useState({
    client_id: google.client_id,
    client_secret: "",
  });

  // Model discovery & catalog states
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [catalogModels, setCatalogModels] = useState<UnifiedModelCatalogItem[]>([]);
  const [isFetchingCatalog, setIsFetchingCatalog] = useState(false);
  const [manualInputMode, setManualInputMode] = useState(false);
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<UnifiedModelCatalogItem | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Controlled form inputs for auto-fill
  const [formModel, setFormModel] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formSttModel, setFormSttModel] = useState("");
  const [formTemperature, setFormTemperature] = useState("0.2");
  const [formMaxOutputTokens, setFormMaxOutputTokens] = useState("1000");
  const [formPriceInput, setFormPriceInput] = useState("");
  const [formPriceOutput, setFormPriceOutput] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formIsFallback, setFormIsFallback] = useState(false);

  async function fetchCatalog(providerToFetch = selectedProvider) {
    setIsFetchingCatalog(true);
    setMessage(null);
    try {
      const response = await fetch("/api/llm/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerToFetch,
          api_key: formApiKey || undefined,
          base_url: formBaseUrl || undefined,
          use_saved_key: true,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        setMessage({
          tone: "error",
          text: data.error || "Gagal menarik katalog model dari provider.",
        });
        return;
      }

      const fetched = Array.isArray(data.models) ? data.models : [];
      setCatalogModels(fetched);
      setModelPickerOpen(true);
    } catch {
      setMessage({
        tone: "error",
        text: "Gagal menghubungi server untuk menarik katalog model.",
      });
    } finally {
      setIsFetchingCatalog(false);
    }
  }

  function handleSelectModel(item: UnifiedModelCatalogItem) {
    setSelectedCatalogItem(item);
    setFormModel(item.id);
    setFormMaxOutputTokens(String(Math.min(item.max_output_tokens || 1000, 8000)));
    setFormPriceInput(
      item.pricing.is_free ? "0" : String(item.pricing.input_per_mtok_usd),
    );
    setFormPriceOutput(
      item.pricing.is_free ? "0" : String(item.pricing.output_per_mtok_usd),
    );
    setFormSttModel(item.recommended_stt_model || "");
    setFormTemperature("0.2");
    setMessage({
      tone: "ok",
      text: `Model "${item.id}" dipilih. Seluruh metadata terisi otomatis.`,
    });
  }
  const prevWahaStatusRef = useRef(initialWahaStatus);

  // Polling status WAHA setiap 5 detik (stabil tanpa reload QR tiap detik)
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/waha/status");
        if (!response.ok) return;
        const data: { status?: unknown } = await response.json();
        const nextStatus = typeof data.status === "string" ? data.status : "UNKNOWN";
        setWahaStatus(nextStatus);

        // Hanya perbarui QR code saat status baru berpindah ke SCAN_QR_CODE
        if (nextStatus === "SCAN_QR_CODE" && prevWahaStatusRef.current !== "SCAN_QR_CODE") {
          setQrKey(Date.now());
        }
        prevWahaStatusRef.current = nextStatus;
      } catch {
        // Abaikan error polling background
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Refresh QR lambat (tiap 30 detik) saat berada di mode SCAN_QR_CODE agar WhatsApp tidak kadaluwarsa
  useEffect(() => {
    if (wahaStatus !== "SCAN_QR_CODE") return;
    const qrTimer = setInterval(() => {
      setQrKey(Date.now());
    }, 30000);
    return () => clearInterval(qrTimer);
  }, [wahaStatus]);

  async function createConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const provider = String(form.get("provider"));
    const model = String(form.get("model") ?? "").trim();
    const apiKey = String(form.get("api_key") ?? "").trim();
    const baseUrl = String(form.get("base_url") ?? "").trim();

    if (!model || !apiKey) {
      setMessage({ tone: "error", text: "Model dan API key wajib diisi." });
      return;
    }
    if (provider === "CUSTOM_OPENAI_COMPAT" && !baseUrl) {
      setMessage({ tone: "error", text: "Base URL wajib diisi untuk provider custom." });
      return;
    }

    setBusy("create-llm");
    setMessage(null);
    try {
      const response = await fetch("/api/llm/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          api_key: apiKey,
          base_url: baseUrl || null,
          stt_model: String(form.get("stt_model") ?? "").trim() || null,
          temperature: Number(form.get("temperature") || 0.3),
          max_output_tokens: Number(form.get("max_output_tokens") || 1000),
          price_input_per_mtok: form.get("price_input_per_mtok")
            ? Number(form.get("price_input_per_mtok"))
            : null,
          price_output_per_mtok: form.get("price_output_per_mtok")
            ? Number(form.get("price_output_per_mtok"))
            : null,
          is_active: form.get("is_active") === "on",
          is_fallback: form.get("is_fallback") === "on",
        }),
      });

      const payload: { error?: unknown } = await response.json();
      if (!response.ok) {
        setMessage({
          tone: "error",
          text: typeof payload.error === "string" ? payload.error : "Gagal menyimpan konfigurasi LLM.",
        });
        return;
      }

      setMessage({ tone: "ok", text: "Konfigurasi LLM berhasil disimpan." });
      formElement.reset();
      setFormModel("");
      setFormApiKey("");
      setFormBaseUrl("");
      setFormSttModel("");
      setFormPriceInput("");
      setFormPriceOutput("");
      setSelectedCatalogItem(null);
      setFormIsFallback(false);
      setFormTemperature("0.2");
      setFormMaxOutputTokens("1000");
      setShowAdvanced(false);
      setManualInputMode(false);
      router.refresh();

      const listRes = await fetch("/api/llm/configs");
      if (listRes.ok) {
        const listData: { configs?: LlmConfig[] } = await listRes.json();
        if (Array.isArray(listData.configs)) {
          setConfigs(listData.configs);
        }
      }
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusy(null);
    }
  }

  async function activateConfig(id: string) {
    setBusy(`activate-${id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/llm/configs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      if (!response.ok) {
        setMessage({ tone: "error", text: "Gagal mengaktifkan konfigurasi LLM." });
        return;
      }
      setConfigs((current) =>
        current.map((c) => ({ ...c, is_active: c.id === id })),
      );
      setMessage({ tone: "ok", text: "Konfigurasi LLM aktif berhasil diubah." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusy(null);
    }
  }

  async function deleteConfig(config: LlmConfig) {
    if (!window.confirm(`Hapus konfigurasi ${config.provider} (${config.model})?`)) return;
    setBusy(`delete-${config.id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/llm/configs/${config.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setMessage({ tone: "error", text: "Gagal menghapus konfigurasi LLM." });
        return;
      }
      setConfigs((current) => current.filter((c) => c.id !== config.id));
      setMessage({ tone: "ok", text: "Konfigurasi LLM berhasil dihapus." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusy(null);
    }
  }

  async function testConfig(id?: string) {
    setBusy(id ? `test-${id}` : "test-active");
    setMessage(null);
    try {
      const response = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { config_id: id } : {}),
      });
      const payload: { ok?: boolean; latency_ms?: number; sample?: unknown; error?: unknown } = await response.json();
      if (payload.ok) {
        setMessage({
          tone: "ok",
          text: `Uji koneksi LLM sukses (${payload.latency_ms ?? 0} ms). Respons: "${String(payload.sample ?? "").trim()}"`,
        });
      } else {
        setMessage({
          tone: "error",
          text: `Uji koneksi LLM gagal (${payload.latency_ms ?? 0} ms): ${JSON.stringify(payload.error)}`,
        });
      }
    } catch {
      setMessage({ tone: "error", text: "Gagal menjalankan uji koneksi LLM." });
    } finally {
      setBusy(null);
    }
  }

  async function triggerWahaSession(action: "start" | "stop" | "restart" | "logout") {
    setBusy(`waha-${action}`);
    setMessage(null);
    try {
      const response = await fetch("/api/waha/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (response.ok) {
        const actionLabels = {
          start: "Sesi WhatsApp dimulai. Silakan pindai kode QR di bawah.",
          stop: "Sesi WhatsApp dihentikan.",
          restart: "Sesi WhatsApp dimulai ulang.",
          logout: "Sesi WhatsApp berhasil direset. Silakan pindai kode QR baru.",
        };
        setMessage({
          tone: "ok",
          text: actionLabels[action] ?? "Aksi berhasil dijalankan.",
        });
        setQrKey(Date.now());
      } else {
        setMessage({ tone: "error", text: `Gagal menjalankan aksi ${action} pada sesi WhatsApp.` });
      }
      const st = await fetch("/api/waha/status");
      if (st.ok) {
        const d: { status?: unknown } = await st.json();
        if (typeof d.status === "string") {
          setWahaStatus(d.status);
        }
      }
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi service WAHA." });
    } finally {
      setBusy(null);
    }
  }

  async function requestWhatsAppPairing(event: React.FormEvent) {
    event.preventDefault();
    if (!waPhone.trim()) {
      setMessage({ tone: "error", text: "Masukkan nomor telepon WhatsApp bot Anda." });
      return;
    }
    setBusy("wa-request-code");
    setMessage(null);
    try {
      const response = await fetch("/api/waha/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: waPhone }),
      });
      const data: { ok?: boolean; code?: string; error?: string } = await response.json();
      if (response.ok && data.code) {
        setWaLinkCode(data.code);
        setMessage({
          tone: "ok",
          text: "Kode taut WhatsApp berhasil didapatkan! Masukkan kode ini pada ponsel Anda.",
        });
      } else {
        setMessage({
          tone: "error",
          text: data.error ?? "Gagal meminta kode taut dari WhatsApp.",
        });
      }
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi server untuk kode taut." });
    } finally {
      setBusy(null);
    }
  }

  async function makePairingCode() {
    setBusy("pairing");
    setMessage(null);
    try {
      const response = await fetch("/api/waha/pairing-code", { method: "POST" });
      const payload: { ok?: boolean; code?: string; error?: string } = await response.json();
      if (response.ok && payload.code) {
        setPairingCode(payload.code);
        setMessage({
          tone: "ok",
          text: "Kode otorisasi pemilik berhasil dibuat. Berlaku selama 10 menit.",
        });
      } else {
        setMessage({ tone: "error", text: payload.error ?? "Gagal membuat kode pairing." });
      }
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusy(null);
    }
  }

  async function saveGoogle(event: React.FormEvent) {
    event.preventDefault();
    if (!googleClient.client_id || !googleClient.client_secret) {
      setMessage({ tone: "error", text: "Client ID dan Client Secret Google wajib diisi." });
      return;
    }
    setBusy("google-save");
    setMessage(null);
    try {
      const response = await fetch("/api/oauth/google/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(googleClient),
      });
      if (response.ok) {
        setMessage({ tone: "ok", text: "Kredensial Google OAuth tersimpan terenkripsi." });
        setGoogleClient((prev) => ({ ...prev, client_secret: "" }));
        router.refresh();
      } else {
        setMessage({ tone: "error", text: "Gagal menyimpan kredensial Google." });
      }
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusy(null);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm("Putuskan koneksi Google? Sinkronisasi Calendar & Tasks akan nonaktif.")) return;
    setBusy("google-disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/google/disconnect", { method: "POST" });
      if (response.ok) {
        setMessage({ tone: "ok", text: "Koneksi Google berhasil diputuskan." });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: "Gagal memutuskan koneksi Google." });
      }
    } catch {
      setMessage({ tone: "error", text: "Gagal menghubungi server." });
    } finally {
      setBusy(null);
    }
  }

  const activeConfig = configs.find((c) => c.is_active);
  const wahaInfo = wahaBadge(wahaStatus);

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-3xl">
        <p className="eyebrow">Pusat koneksi</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Integrasi</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Kelola mesin AI bahasa (LLM), koneksi WhatsApp bot melalui WAHA, dan sinkronisasi agenda Google.
        </p>
      </header>

      {message ? (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded border px-4 py-3 text-sm ${
            message.tone === "error"
              ? "border-[#e7c3be] bg-[var(--danger-soft)] text-[var(--danger)]"
              : "border-[#c7d5ad] bg-[var(--success-soft)] text-[var(--success)]"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {/* Bagian 1: Multi-LLM Manager */}
      <section className="panel p-5 sm:p-6" aria-labelledby="llm-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="llm-heading" className="text-lg font-semibold">
              Model Bahasa (LLM)
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Kunci API disimpan terenkripsi dengan AES-256-GCM.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted)]">Aktif saat ini:</span>
            {activeConfig ? (
              <span className="badge badge-success font-medium">
                {activeConfig.provider} · {activeConfig.model}
              </span>
            ) : (
              <span className="badge badge-warning">Belum ada aktif</span>
            )}
            <button
              type="button"
              disabled={!activeConfig || busy !== null}
              onClick={() => testConfig()}
              className="btn btn-secondary text-xs"
            >
              {busy === "test-active" ? "Menguji..." : "Uji aktif"}
            </button>
          </div>
        </div>

        {/* Peringatan model gratis tanpa fallback */}
        {activeConfig?.model.includes(":free") && !configs.some((c) => c.is_fallback) && (
          <div
            role="alert"
            className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
          >
            <strong>Perhatian:</strong> Model aktif utama menggunakan tier gratis ({activeConfig.model}) dan belum ada model cadangan (fallback) yang dikonfigurasi. Disarankan mengaktifkan model cadangan untuk menghindari kegagalan saat terkena rate limit.
          </div>
        )}

        {/* Daftar konfigurasi tersimpan */}
        <div className="mt-4">
          <p className="eyebrow mb-2">Konfigurasi tersimpan</p>
          {configs.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Belum ada konfigurasi LLM tersimpan.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {configs.map((config) => {
                const isItemBusy =
                  busy === `activate-${config.id}` ||
                  busy === `delete-${config.id}` ||
                  busy === `test-${config.id}`;
                return (
                  <div
                    key={config.id}
                    className={`flex flex-col justify-between rounded border p-3 ${
                      config.is_active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--line)] bg-[var(--surface)]"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                          {config.provider}
                        </span>
                        {config.is_active ? (
                          <span className="badge badge-success text-[0.68rem]">Aktif</span>
                        ) : config.is_fallback ? (
                          <span className="badge badge-warning text-[0.68rem]">Fallback</span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-mono text-sm font-semibold">{config.model}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        Temp: {config.temperature} · Max: {config.max_output_tokens} tok
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1 border-t border-[var(--line)] pt-2">
                      {!config.is_active ? (
                        <button
                          type="button"
                          disabled={isItemBusy}
                          onClick={() => activateConfig(config.id)}
                          className="btn btn-quiet text-xs font-semibold text-[var(--accent)]"
                        >
                          Aktifkan
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={isItemBusy}
                        onClick={() => testConfig(config.id)}
                        className="btn btn-quiet text-xs"
                      >
                        Uji
                      </button>
                      <button
                        type="button"
                        disabled={isItemBusy}
                        onClick={() => deleteConfig(config)}
                        className="btn btn-quiet text-xs text-[var(--danger)]"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Form tambah konfigurasi LLM baru dengan Progressive Disclosure */}
        <form onSubmit={createConfig} className="mt-6 border-t border-[var(--line)] pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <p className="eyebrow">Tambah Konfigurasi Baru</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Pilih provider dan model untuk menjalankan kecerdasan asisten bot.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!manualInputMode) {
                  setManualInputMode(true);
                  setShowAdvanced(true);
                } else {
                  setManualInputMode(false);
                }
              }}
              className="btn btn-quiet min-h-[44px] text-xs font-mono text-[var(--muted)] hover:text-[var(--ink)]"
            >
              {manualInputMode ? "[ Kembali ke Mode Katalog ]" : "[ Masukkan Model Secara Manual ]"}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-12">
            {/* Baris 1: Provider & Model */}
            <label className="field-label md:col-span-5">
              Provider
              <select
                name="provider"
                value={selectedProvider}
                onChange={(e) => {
                  const nextProvider = e.target.value;
                  setSelectedProvider(nextProvider);
                  setSelectedCatalogItem(null);
                  setFormModel("");
                }}
                className="field min-h-[44px]"
              >
                {providers.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="md:col-span-7 flex flex-col justify-end">
              {manualInputMode ? (
                <label className="field-label">
                  Nama Model (Input Manual)
                  <input
                    name="model"
                    required
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    className="field w-full font-mono text-sm min-h-[44px]"
                    placeholder={
                      selectedProvider === "ANTHROPIC"
                        ? "claude-3-5-sonnet-20241022"
                        : "gpt-4o-mini"
                    }
                  />
                </label>
              ) : (
                <div>
                  <span className="field-label block mb-1">
                    Model Terpilih
                  </span>
                  {selectedCatalogItem && formModel ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-2 min-h-[44px]">
                      <input type="hidden" name="model" value={formModel} />
                      <div className="min-w-0 flex-1 pl-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-[var(--accent-strong)] truncate">
                            {selectedCatalogItem.id}
                          </span>
                          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] border border-[var(--line)]">
                            {selectedCatalogItem.context_length >= 1_000_000
                              ? `${(selectedCatalogItem.context_length / 1_000_000).toFixed(1)}m ctx`
                              : `${Math.round(selectedCatalogItem.context_length / 1000)}k ctx`}
                          </span>
                          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] border border-[var(--line)]">
                            {selectedCatalogItem.pricing.is_free
                              ? "GRATIS"
                              : `$${selectedCatalogItem.pricing.input_per_mtok_usd} / $${selectedCatalogItem.pricing.output_per_mtok_usd}`}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => fetchCatalog()}
                        disabled={isFetchingCatalog}
                        className="btn btn-secondary min-h-[36px] px-2.5 py-1 text-xs font-mono shrink-0"
                      >
                        [ Ganti Model ]
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input type="hidden" name="model" value={formModel} />
                      <button
                        type="button"
                        onClick={() => fetchCatalog()}
                        disabled={isFetchingCatalog}
                        className="btn btn-secondary w-full min-h-[44px] text-xs font-mono font-medium flex items-center justify-center gap-2 border border-dashed border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                      >
                        {isFetchingCatalog ? (
                          <>
                            <span className="animate-spin text-sm">⟳</span>
                            <span>Menarik Katalog Model...</span>
                          </>
                        ) : (
                          <>
                            <span className="text-[var(--accent)] font-bold">⌕</span>
                            <span>Buka Katalog Model ({providers.find((p) => p.value === selectedProvider)?.label})</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Baris 2: API Key & (Base URL bila custom) */}
            <div className={selectedProvider === "CUSTOM_OPENAI_COMPAT" ? "md:col-span-6" : "md:col-span-12"}>
              <label className="field-label">
                API Key (Rahasia)
                <input
                  name="api_key"
                  type="password"
                  required
                  minLength={8}
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  className="field min-h-[44px]"
                  placeholder={apiKeyPlaceholder(selectedProvider)}
                />
              </label>
            </div>

            {selectedProvider === "CUSTOM_OPENAI_COMPAT" && (
              <div className="md:col-span-6">
                <label className="field-label">
                  Base URL <span className="text-[var(--danger)]">(Wajib)</span>
                  <input
                    name="base_url"
                    type="url"
                    required
                    value={formBaseUrl}
                    onChange={(e) => setFormBaseUrl(e.target.value)}
                    className="field font-mono text-xs min-h-[44px]"
                    placeholder="http://localhost:11434/v1"
                  />
                </label>
              </div>
            )}

            {/* Accordion Toggle: Pengaturan Lanjutan & Override Biaya */}
            <div className="md:col-span-12 pt-1">
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="flex items-center gap-2 text-xs font-mono font-semibold text-[var(--accent-strong)] hover:text-[var(--ink)] min-h-[44px] py-2"
                aria-expanded={showAdvanced}
              >
                <span aria-hidden="true">{showAdvanced ? "▾" : "▸"}</span>
                <span>
                  {showAdvanced
                    ? "Sembunyikan Pengaturan Lanjutan & Override Biaya"
                    : "Pengaturan Lanjutan & Override Biaya"}
                </span>
                {selectedCatalogItem && !showAdvanced && (
                  <span className="text-[11px] font-normal text-[var(--muted)] hidden sm:inline">
                    (Otomatis: max {formMaxOutputTokens} tok · temp {formTemperature})
                  </span>
                )}
              </button>
            </div>

            {/* Panel Pengaturan Lanjutan (Collapsible Grid) */}
            {showAdvanced && (
              <div className="md:col-span-12 p-4 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)]/50 grid gap-3 md:grid-cols-12 animate-in fade-in-50 duration-150">
                {selectedProvider !== "CUSTOM_OPENAI_COMPAT" && (
                  <div className="md:col-span-6">
                    <label className="field-label text-xs">
                      Base URL (Opsional)
                      <input
                        name="base_url"
                        type="url"
                        value={formBaseUrl}
                        onChange={(e) => setFormBaseUrl(e.target.value)}
                        className="field font-mono text-xs min-h-[44px]"
                        placeholder="https://api.openai.com/v1"
                      />
                    </label>
                  </div>
                )}

                <div className={selectedProvider === "CUSTOM_OPENAI_COMPAT" ? "md:col-span-12" : "md:col-span-6"}>
                  <label className="field-label text-xs">
                    Model STT Audio (Opsional)
                    <input
                      name="stt_model"
                      value={formSttModel}
                      onChange={(e) => setFormSttModel(e.target.value)}
                      className="field font-mono text-xs min-h-[44px]"
                      placeholder="whisper-1"
                    />
                  </label>
                </div>

                <div className="md:col-span-3">
                  <label className="field-label text-xs">
                    Temperature
                    <input
                      name="temperature"
                      type="number"
                      step="0.05"
                      min="0"
                      max="2"
                      value={formTemperature}
                      onChange={(e) => setFormTemperature(e.target.value)}
                      className="field font-mono text-xs min-h-[44px]"
                    />
                  </label>
                </div>

                <div className="md:col-span-3">
                  <label className="field-label text-xs">
                    Maks Output Tokens
                    <input
                      name="max_output_tokens"
                      type="number"
                      min="1"
                      max="8000"
                      value={formMaxOutputTokens}
                      onChange={(e) => setFormMaxOutputTokens(e.target.value)}
                      className="field font-mono text-xs min-h-[44px]"
                    />
                  </label>
                </div>

                <div className="md:col-span-3">
                  <label className="field-label text-xs">
                    Harga Input per 1M Tok ($)
                    <input
                      name="price_input_per_mtok"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={formPriceInput}
                      onChange={(e) => setFormPriceInput(e.target.value)}
                      className="field font-mono text-xs min-h-[44px]"
                      placeholder="0.15"
                    />
                  </label>
                </div>

                <div className="md:col-span-3">
                  <label className="field-label text-xs">
                    Harga Output per 1M Tok ($)
                    <input
                      name="price_output_per_mtok"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={formPriceOutput}
                      onChange={(e) => setFormPriceOutput(e.target.value)}
                      className="field font-mono text-xs min-h-[44px]"
                      placeholder="0.60"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Checkbox Status Aktif */}
            <div className="flex items-center gap-2 md:col-span-12 pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm min-h-[44px]">
                <input
                  name="is_active"
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="size-4 rounded accent-[var(--accent)]"
                />
                Jadikan konfigurasi aktif langsung setelah disimpan
              </label>
            </div>

            {/* Checkbox Status Fallback */}
            <div className="flex items-center gap-2 md:col-span-12">
              <label className="flex cursor-pointer items-center gap-2 text-sm min-h-[44px]">
                <input
                  name="is_fallback"
                  type="checkbox"
                  checked={formIsFallback}
                  onChange={(e) => setFormIsFallback(e.target.checked)}
                  className="size-4 rounded accent-[var(--accent)]"
                />
                Jadikan model cadangan (fallback)
              </label>
            </div>

            {/* Tombol Simpan & Tautan Fallback */}
            <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="submit"
                disabled={busy === "create-llm"}
                className="btn btn-primary min-h-[44px] px-6"
              >
                {busy === "create-llm" ? "Menyimpan..." : "Simpan Konfigurasi LLM"}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!manualInputMode) {
                    setManualInputMode(true);
                    setShowAdvanced(true);
                  } else {
                    setManualInputMode(false);
                  }
                }}
                className="btn btn-quiet min-h-[44px] text-xs font-mono text-[var(--muted)] hover:text-[var(--ink)]"
              >
                {manualInputMode ? "[ Kembali ke Mode Katalog ]" : "[ Masukkan Model Secara Manual ]"}
              </button>
            </div>
          </div>
        </form>

        {/* Modal Katalog Model Utilitarian */}
        <ModelPickerModal
          isOpen={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
          models={catalogModels}
          selectedProvider={selectedProvider}
          onSelectModel={handleSelectModel}
          isLoading={isFetchingCatalog}
        />
      </section>

      {/* Bagian 2: WhatsApp (WAHA) */}
      <section className="panel p-5 sm:p-6" aria-labelledby="waha-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="waha-heading" className="text-lg font-semibold">
              WhatsApp Bot Engine (WAHA)
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Koneksi nomor WhatsApp bot operasional menggunakan engine berkecepatan tinggi.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-success text-[0.68rem]">
              Anti-Ban Guard (INV-13): Aktif
            </span>
            <span className="text-xs text-[var(--muted)]">Status koneksi:</span>
            <span className={wahaInfo.cls}>{wahaInfo.label}</span>
          </div>
        </div>
        {/* Status banner & call-to-actions */}
        {wahaStatus === "WORKING" ? (
          <div className="mt-4 rounded border border-[#c7d5ad] bg-[var(--success-soft)] p-4">
            <p className="font-semibold text-[var(--success)]">Nomor WhatsApp Bot Terhubung!</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Botseri siap mengirim pesan to-do, menerima pesan pesanan pelanggan, dan memproses jadwal.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => triggerWahaSession("stop")}
                className="btn btn-secondary text-xs text-[var(--danger)]"
              >
                {busy === "waha-stop" ? "Menghentikan..." : "Hentikan sesi"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => triggerWahaSession("logout")}
                className="btn btn-secondary text-xs"
              >
                {busy === "waha-logout" ? "Mereset..." : "Ganti / Tautkan nomor lain"}
              </button>
            </div>
          </div>
        ) : null}

        {wahaStatus === "STOPPED" ? (
          <div className="mt-4 rounded border border-[var(--line)] bg-[var(--surface-muted)] p-4">
            <p className="font-medium text-[var(--ink)]">Sesi WhatsApp Belum Aktif</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Klik tombol Mulai Sesi untuk mengaktifkan engine dan memunculkan kode QR atau kode tautan nomor.
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => triggerWahaSession("start")}
              className="btn btn-primary mt-3 text-sm"
            >
              {busy === "waha-start" ? "Memulai sesi..." : "Mulai sesi WhatsApp"}
            </button>
          </div>
        ) : null}

        {wahaStatus === "STARTING" ? (
          <div className="mt-4 rounded border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-center">
            <p className="font-medium">Memulai sesi WhatsApp...</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Sedang menyiapkan koneksi websocket dan kode QR (biasanya 2 hingga 4 detik).
            </p>
          </div>
        ) : null}

        {wahaStatus === "FAILED" ? (
          <div className="mt-4 rounded border border-[#e7c3be] bg-[var(--danger-soft)] p-4">
            <p className="font-semibold text-[var(--danger)]">Koneksi Sesi Terputus atau Gagal</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Sesi sebelumnya tidak dapat tersambung kembali. Klik Reset Sesi untuk menghasilkan kode QR baru.
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => triggerWahaSession("logout")}
              className="btn btn-primary mt-3 text-sm"
            >
              {busy === "waha-logout" ? "Mereset..." : "Reset sesi dan buat QR baru"}
            </button>
          </div>
        ) : null}

        {/* Tampilan QR Code dan Link dengan Nomor Telepon saat SCAN_QR_CODE */}
        {wahaStatus === "SCAN_QR_CODE" ? (
          <div className="mt-5 rounded border border-[var(--warning)] bg-[var(--warning-soft)] p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              {/* Gambar QR Code */}
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/waha/qr?t=${qrKey}`}
                  alt="QR Code WhatsApp"
                  className="size-64 rounded border border-[var(--line)] bg-white object-contain shadow-sm"
                />
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => triggerWahaSession("restart")}
                  className="btn btn-secondary text-xs"
                >
                  {busy === "waha-restart" ? "Membuat QR baru..." : "Buat QR Baru"}
                </button>
              </div>

              {/* Panduan Pemindaian */}
              <div className="flex-1">
                <p className="font-semibold text-[var(--warning)]">Pindai Kode QR WhatsApp</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-5 text-[var(--ink)]">
                  <li>Buka aplikasi WhatsApp di ponsel nomor bot Anda.</li>
                  <li>Buka <strong>Setelan</strong> (atau titik tiga di kanan atas) &gt; <strong>Perangkat Tertaut</strong>.</li>
                  <li>Ketuk tombol <strong>Tautkan Perangkat</strong>.</li>
                  <li>Arahkan kamera ponsel Anda ke kode QR di samping.</li>
                </ol>
                <p className="mt-2 text-[0.72rem] text-[var(--muted)]">
                  Kode QR aktif diperbarui otomatis secara berkala. Pastikan layar komputer terang dan tidak silau.
                </p>

                {/* Alternatif: Tautkan Menggunakan Nomor Telepon */}
                <div className="mt-4 border-t border-[var(--line)] pt-3">
                  <button
                    type="button"
                    onClick={() => setShowPhoneLinking((v) => !v)}
                    className="text-xs font-semibold text-[var(--accent-strong)] underline hover:text-[var(--accent)]"
                  >
                    {showPhoneLinking
                      ? "Sembunyikan opsi tautan nomor telepon"
                      : "Kamera bermasalah? Tautkan dengan nomor telepon"}
                  </button>

                  {showPhoneLinking ? (
                    <form onSubmit={requestWhatsAppPairing} className="mt-3 flex flex-col gap-2">
                      <label className="field-label">
                        Nomor WhatsApp Bot
                        <input
                          value={waPhone}
                          onChange={(e) => setWaPhone(e.target.value)}
                          placeholder="Contoh: 6281234567890 (dengan kode negara)"
                          className="field text-xs"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy === "wa-request-code"}
                        className="btn btn-secondary self-start text-xs"
                      >
                        {busy === "wa-request-code" ? "Meminta kode..." : "Dapatkan kode tautan WhatsApp (8 digit)"}
                      </button>

                      {waLinkCode ? (
                        <div className="mt-2 rounded border border-[var(--accent)] bg-white p-3">
                          <p className="eyebrow">Kode Tautan WhatsApp Ponsel</p>
                          <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-[var(--accent-strong)]">
                            {waLinkCode}
                          </p>
                          <p className="mt-1 text-[0.72rem] text-[var(--muted)]">
                            Buka WhatsApp di ponsel &gt; Perangkat Tertaut &gt; Tautkan Perangkat &gt; <strong>Tautkan dengan nomor telepon saja</strong>, lalu masukkan 8 karakter di atas.
                          </p>
                        </div>
                      ) : null}
                    </form>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Kartu Otorisasi Nomor Pemilik Usaha (Botseri Security Code) */}
        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Keamanan Botseri</p>
              <h3 className="text-sm font-semibold">Otorisasi Nomor Pemilik (Owner Pairing)</h3>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Setelah nomor bot tersambung ke WhatsApp, buat kode ini untuk mengesahkan nomor pribadi Anda sebagai Owner.
              </p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={makePairingCode}
              className="btn btn-secondary text-xs"
            >
              {busy === "pairing" ? "Membuat..." : "Buat kode otorisasi pemilik"}
            </button>
          </div>

          {pairingCode ? (
            <div className="mt-3 rounded border border-[var(--accent)] bg-[var(--surface-muted)] p-4">
              <p className="eyebrow">Kode Verifikasi Owner</p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-[var(--accent-strong)]">
                {pairingCode}
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Kirimkan kode di atas melalui chat WhatsApp dari nomor pribadi Anda ke nomor bot Botseri.
                Nomor Anda akan otomatis tercatat sebagai pemilik sah (Owner). Berlaku selama 10 menit.
              </p>
            </div>
          ) : null}

        {/* Daftar Nomor Terhubung & Terotorisasi */}
        <AuthorizedNumbersList
          initialNumbers={initialAuthorizedNumbers}
          timezone={timezone}
        />
        </div>
      </section>

      {/* Bagian 3: Google OAuth (Calendar & Tasks) */}
      <section className="panel p-5 sm:p-6" aria-labelledby="google-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div>
            <h2 id="google-heading" className="text-lg font-semibold">
              Google Workspace (Calendar & Tasks)
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Sinkronisasi jadwal pesanan dan to-do operasional ke akun Google.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted)]">Koneksi:</span>
            <span className={googleBadgeClass(google.status)}>
              {google.status === "CONNECTED"
                ? "Terhubung"
                : google.status === "NEEDS_REAUTH"
                  ? "Perlu otorisasi ulang"
                  : "Belum terhubung"}
            </span>
            {google.account_email ? (
              <span className="text-xs font-medium text-[var(--muted)]">
                ({google.account_email})
              </span>
            ) : null}
          </div>
        </div>

        {/* Form simpan kredensial OAuth */}
        <form onSubmit={saveGoogle} className="mt-4">
          <p className="eyebrow mb-2">Kredensial OAuth2 Client</p>
          <div className="grid gap-3 md:grid-cols-12">
            <label className="field-label md:col-span-6">
              Client ID
              <input
                value={googleClient.client_id}
                onChange={(e) =>
                  setGoogleClient((prev) => ({ ...prev, client_id: e.target.value }))
                }
                required
                className="field"
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </label>

            <label className="field-label md:col-span-6">
              Client Secret (Disimpan Terenkripsi)
              <input
                value={googleClient.client_secret}
                onChange={(e) =>
                  setGoogleClient((prev) => ({ ...prev, client_secret: e.target.value }))
                }
                type="password"
                required
                className="field"
                placeholder="GOCSPX-..."
              />
            </label>

            <div className="md:col-span-12">
              <button
                type="submit"
                disabled={busy === "google-save"}
                className="btn btn-secondary text-sm"
              >
                {busy === "google-save" ? "Menyimpan..." : "Simpan kredensial Google"}
              </button>
            </div>
          </div>
        </form>

        {/* Informasi Redirect URI */}
        <div className="mt-4 rounded border border-[var(--line)] bg-[var(--surface-muted)] p-3">
          <p className="eyebrow">Authorized Redirect URI</p>
          <p className="mt-1 font-mono text-xs break-all text-[var(--ink)]">
            {oauthRedirectUri}
          </p>
          <p className="mt-1 text-[0.72rem] text-[var(--muted)]">
            Salin URL ini ke Google Cloud Console pada tab Credentials &gt; OAuth 2.0 Client IDs.
          </p>
        </div>

        {/* Tombol aksi OAuth */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
          <a
            href="/api/oauth/google/start"
            className="btn btn-primary text-sm"
          >
            Hubungkan akun Google
          </a>
          {google.status === "CONNECTED" || google.status === "NEEDS_REAUTH" ? (
            <button
              type="button"
              disabled={busy === "google-disconnect"}
              onClick={disconnectGoogle}
              className="btn btn-danger text-sm"
            >
              {busy === "google-disconnect" ? "Memutuskan..." : "Putuskan koneksi Google"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
