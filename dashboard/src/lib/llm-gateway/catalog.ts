import {
  ANTHROPIC_CURATED_MODELS,
  GEMINI_CURATED_MODELS,
  OPENAI_CURATED_MODELS,
} from "./pricing-tables";

export type LlmProviderType =
  | "OPENROUTER"
  | "OPENAI"
  | "GEMINI"
  | "ANTHROPIC"
  | "CUSTOM_OPENAI_COMPAT";

export interface UnifiedModelCatalogItem {
  id: string;
  name: string;
  provider: LlmProviderType;
  context_length: number;
  max_output_tokens: number;
  pricing: {
    input_per_mtok_usd: number;
    output_per_mtok_usd: number;
    is_free: boolean;
  };
  capabilities: {
    vision: boolean;
    audio_stt: boolean;
    function_calling: boolean;
    reasoning: boolean;
  };
  recommended_stt_model?: string;
  description?: string;
}

export interface FetchCatalogOptions {
  provider: LlmProviderType;
  apiKey?: string;
  baseUrl?: string;
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;


// -----------------------------------------------------------------------------
// 1. OPENROUTER ADAPTER
// -----------------------------------------------------------------------------
type OpenRouterRawModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string | null;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
  top_provider?: {
    max_completion_tokens?: number | null;
    is_moderated?: boolean;
  };
  supported_parameters?: string[];
};

export async function fetchOpenRouterCatalog(
  apiKey?: string,
): Promise<UnifiedModelCatalogItem[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "HTTP-Referer": "https://botseri.local",
    "X-Title": "Botseri Operational Assistant",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter API mengembalikan status ${res.status}: ${errorText.slice(0, 150) || res.statusText}`,
    );
  }

  const json = (await res.json()) as { data?: OpenRouterRawModel[] };
  const rawList = Array.isArray(json.data) ? json.data : [];

  return rawList.map((item): UnifiedModelCatalogItem => {
    const promptUnit = Number.parseFloat(item.pricing?.prompt || "0");
    const completionUnit = Number.parseFloat(item.pricing?.completion || "0");

    const inputPricePerMtok = Number.isFinite(promptUnit)
      ? promptUnit * 1_000_000
      : 0;
    const outputPricePerMtok = Number.isFinite(completionUnit)
      ? completionUnit * 1_000_000
      : 0;

    const isFree =
      (inputPricePerMtok === 0 && outputPricePerMtok === 0) ||
      item.id.endsWith(":free");

    const modality = item.architecture?.modality?.toLowerCase() || "";
    const isVision =
      modality.includes("image") ||
      modality.includes("multimodal") ||
      item.id.includes("vision") ||
      item.id.includes("vl");

    const isAudio = modality.includes("audio");

    const params = Array.isArray(item.supported_parameters)
      ? item.supported_parameters
      : [];
    const isFunctionCalling =
      params.includes("tools") ||
      params.includes("function_call") ||
      params.includes("tool_choice");

    const lowerId = item.id.toLowerCase();
    const isReasoning =
      lowerId.includes("o1") ||
      lowerId.includes("o3") ||
      lowerId.includes("r1") ||
      lowerId.includes("deepseek-r1") ||
      lowerId.includes("reasoning") ||
      Boolean(item.description?.toLowerCase().includes("reasoning"));

    return {
      id: item.id,
      name: item.name || item.id,
      provider: "OPENROUTER",
      context_length: item.context_length || 8192,
      max_output_tokens: item.top_provider?.max_completion_tokens || 4096,
      pricing: {
        input_per_mtok_usd: Number(inputPricePerMtok.toFixed(4)),
        output_per_mtok_usd: Number(outputPricePerMtok.toFixed(4)),
        is_free: isFree,
      },
      capabilities: {
        vision: isVision,
        audio_stt: isAudio,
        function_calling: isFunctionCalling,
        reasoning: isReasoning,
      },
      recommended_stt_model: "openai/whisper-1",
      description: item.description,
    };
  });
}

// -----------------------------------------------------------------------------
// 2. OPENAI ADAPTER
// -----------------------------------------------------------------------------
type OpenAiRawModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

export async function fetchOpenAiCatalog(
  apiKey: string,
  baseUrl = "https://api.openai.com/v1",
): Promise<UnifiedModelCatalogItem[]> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${cleanBase}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(
      `OpenAI API mengembalikan status ${res.status}: ${errorText.slice(0, 150) || res.statusText}`,
    );
  }

  const json = (await res.json()) as { data?: OpenAiRawModel[] };
  const rawList = Array.isArray(json.data) ? json.data : [];

  // Filter model yang relevan untuk obrolan/komplesi
  const chatModels = rawList.filter((m) => {
    const id = m.id.toLowerCase();
    const isExcluded =
      id.includes("embedding") ||
      id.includes("tts") ||
      id.includes("dall-e") ||
      id.includes("whisper") ||
      id.includes("babbage") ||
      id.includes("davinci") ||
      id.includes("moderation");
    if (isExcluded) return false;

    return (
      id.startsWith("gpt-") ||
      id.startsWith("o1") ||
      id.startsWith("o3") ||
      id.startsWith("chatgpt-") ||
      Boolean(OPENAI_CURATED_MODELS[m.id])
    );
  });

  // Urutkan model curated di paling atas
  chatModels.sort((a, b) => {
    const aCurated = OPENAI_CURATED_MODELS[a.id] ? 1 : 0;
    const bCurated = OPENAI_CURATED_MODELS[b.id] ? 1 : 0;
    if (aCurated !== bCurated) return bCurated - aCurated;
    return a.id.localeCompare(b.id);
  });

  return chatModels.map((item): UnifiedModelCatalogItem => {
    const curated = OPENAI_CURATED_MODELS[item.id];
    if (curated) {
      return {
        id: item.id,
        name: curated.name,
        provider: "OPENAI",
        context_length: curated.context_length,
        max_output_tokens: curated.max_output_tokens,
        pricing: { ...curated.pricing },
        capabilities: { ...curated.capabilities },
        recommended_stt_model: curated.recommended_stt_model,
        description: curated.description,
      };
    }

    // Heuristik untuk model baru yang belum masuk tabel kurasi
    const isVision = item.id.includes("4o") || item.id.includes("vision");
    const isReasoning = item.id.startsWith("o1") || item.id.startsWith("o3");

    return {
      id: item.id,
      name: item.id,
      provider: "OPENAI",
      context_length: 128_000,
      max_output_tokens: isReasoning ? 32_768 : 4096,
      pricing: {
        input_per_mtok_usd: isReasoning ? 5.0 : 2.5,
        output_per_mtok_usd: isReasoning ? 20.0 : 10.0,
        is_free: false,
      },
      capabilities: {
        vision: isVision,
        audio_stt: false,
        function_calling: true,
        reasoning: isReasoning,
      },
      recommended_stt_model: "whisper-1",
    };
  });
}

// -----------------------------------------------------------------------------
// 3. GEMINI ADAPTER (Google AI Studio)
// -----------------------------------------------------------------------------
type GeminiRawModel = {
  name: string; // e.g. "models/gemini-2.5-flash"
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  temperature?: number;
  topP?: number;
};

export async function fetchGeminiCatalog(
  apiKey: string,
): Promise<UnifiedModelCatalogItem[]> {
  const cleanKey = apiKey.trim();
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-goog-api-key": cleanKey,
    },
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(
      `Google Gemini API mengembalikan status ${res.status}: ${errorText.slice(0, 150) || res.statusText}`,
    );
  }

  const json = (await res.json()) as { models?: GeminiRawModel[] };
  const rawList = Array.isArray(json.models) ? json.models : [];

  const contentModels = rawList.filter((m) =>
    Array.isArray(m.supportedGenerationMethods)
      ? m.supportedGenerationMethods.includes("generateContent")
      : false,
  );

  return contentModels.map((item): UnifiedModelCatalogItem => {
    const cleanId = item.name.replace(/^models\//, "");
    const curated = GEMINI_CURATED_MODELS[cleanId];

    if (curated) {
      return {
        id: cleanId,
        name: item.displayName || curated.name,
        provider: "GEMINI",
        context_length: item.inputTokenLimit || curated.context_length,
        max_output_tokens: item.outputTokenLimit || curated.max_output_tokens,
        pricing: { ...curated.pricing },
        capabilities: { ...curated.capabilities },
        recommended_stt_model: curated.recommended_stt_model,
        description: item.description || curated.description,
      };
    }

    const isReasoning =
      cleanId.includes("thinking") ||
      cleanId.includes("pro") ||
      Boolean(item.description?.toLowerCase().includes("reasoning"));

    return {
      id: cleanId,
      name: item.displayName || cleanId,
      provider: "GEMINI",
      context_length: item.inputTokenLimit || 1_048_576,
      max_output_tokens: item.outputTokenLimit || 8192,
      pricing: {
        input_per_mtok_usd: isReasoning ? 1.25 : 0.075,
        output_per_mtok_usd: isReasoning ? 5.0 : 0.3,
        is_free: false,
      },
      capabilities: {
        vision: true,
        audio_stt: true,
        function_calling: true,
        reasoning: isReasoning,
      },
      recommended_stt_model: cleanId.includes("flash")
        ? cleanId
        : "gemini-2.5-flash",
      description: item.description,
    };
  });
}

// -----------------------------------------------------------------------------
// 4. ANTHROPIC ADAPTER
// -----------------------------------------------------------------------------
type AnthropicRawModel = {
  id: string;
  type?: string;
  display_name?: string;
  created_at?: string;
};

export async function fetchAnthropicCatalog(
  apiKey?: string,
): Promise<UnifiedModelCatalogItem[]> {
  // Jika API key disediakan, coba panggil API resmi Anthropic
  if (apiKey?.trim()) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      });

      if (res.ok) {
        const json = (await res.json()) as { data?: AnthropicRawModel[] };
        const rawList = Array.isArray(json.data) ? json.data : [];

        if (rawList.length > 0) {
          return rawList.map((item): UnifiedModelCatalogItem => {
            const curated = ANTHROPIC_CURATED_MODELS[item.id];
            if (curated) {
              return {
                id: item.id,
                name: item.display_name || curated.name,
                provider: "ANTHROPIC",
                context_length: curated.context_length,
                max_output_tokens: curated.max_output_tokens,
                pricing: { ...curated.pricing },
                capabilities: { ...curated.capabilities },
                recommended_stt_model: curated.recommended_stt_model,
                description: curated.description,
              };
            }

            const isHaiku = item.id.includes("haiku");
            const isOpus = item.id.includes("opus");
            return {
              id: item.id,
              name: item.display_name || item.id,
              provider: "ANTHROPIC",
              context_length: 200_000,
              max_output_tokens: 8192,
              pricing: {
                input_per_mtok_usd: isHaiku ? 0.8 : isOpus ? 15.0 : 3.0,
                output_per_mtok_usd: isHaiku ? 4.0 : isOpus ? 75.0 : 15.0,
                is_free: false,
              },
              capabilities: {
                vision: !isHaiku,
                audio_stt: false,
                function_calling: true,
                reasoning: false,
              },
              recommended_stt_model: "whisper-1",
            };
          });
        }
      }
    } catch {
      // Fallback ke curated catalog di bawah jika request gagal
    }
  }

  // Fallback ke curated catalog statis Anthropic
  return Object.entries(ANTHROPIC_CURATED_MODELS).map(([id, meta]) => ({
    id,
    name: meta.name,
    provider: "ANTHROPIC",
    context_length: meta.context_length,
    max_output_tokens: meta.max_output_tokens,
    pricing: { ...meta.pricing },
    capabilities: { ...meta.capabilities },
    recommended_stt_model: meta.recommended_stt_model,
    description: meta.description,
  }));
}

// -----------------------------------------------------------------------------
// 5. CUSTOM OPENAI COMPATIBLE ADAPTER (Ollama, vLLM, LMStudio, LocalAI)
// -----------------------------------------------------------------------------
type CustomRawModel = {
  id: string;
  name?: string;
};

export async function fetchCustomCatalog(
  baseUrl: string,
  apiKey?: string,
): Promise<UnifiedModelCatalogItem[]> {
  const cleanBase = (baseUrl || "http://localhost:11434/v1").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const res = await fetch(`${cleanBase}/models`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(
      `Custom Provider (${cleanBase}) mengembalikan status ${res.status}: ${errorText.slice(0, 150) || res.statusText}`,
    );
  }

  const json = (await res.json()) as
    | { data?: CustomRawModel[]; models?: CustomRawModel[] }
    | CustomRawModel[];
  let rawList: CustomRawModel[] = [];

  if (Array.isArray(json)) {
    rawList = json;
  } else if (Array.isArray(json.data)) {
    rawList = json.data;
  } else if (Array.isArray(json.models)) {
    rawList = json.models;
  }

  return rawList.map((item): UnifiedModelCatalogItem => {
    const id = item.id || item.name || "custom-model";
    const lowerId = id.toLowerCase();
    const isVision =
      lowerId.includes("vision") ||
      lowerId.includes("vl") ||
      lowerId.includes("llava");
    const isReasoning =
      lowerId.includes("r1") ||
      lowerId.includes("reasoning") ||
      lowerId.includes("think");

    return {
      id,
      name: item.name || id,
      provider: "CUSTOM_OPENAI_COMPAT",
      context_length: 8192,
      max_output_tokens: 2048,
      pricing: {
        input_per_mtok_usd: 0.0,
        output_per_mtok_usd: 0.0,
        is_free: true,
      },
      capabilities: {
        vision: isVision,
        audio_stt: false,
        function_calling: true,
        reasoning: isReasoning,
      },
      recommended_stt_model: "whisper-1",
      description: `Model lokal/kustom dari endpoint ${cleanBase}`,
    };
  });
}

// -----------------------------------------------------------------------------
// MASTER CATALOG FETCHER
// -----------------------------------------------------------------------------
export async function fetchModelCatalog(
  options: FetchCatalogOptions,
): Promise<UnifiedModelCatalogItem[]> {
  const { provider, apiKey, baseUrl } = options;

  switch (provider) {
    case "OPENROUTER":
      return fetchOpenRouterCatalog(apiKey);

    case "OPENAI":
      if (!apiKey?.trim()) {
        // Jika belum ada API key, kembalikan daftar model curated OpenAI
        return Object.entries(OPENAI_CURATED_MODELS).map(([id, meta]) => ({
          id,
          name: meta.name,
          provider: "OPENAI",
          context_length: meta.context_length,
          max_output_tokens: meta.max_output_tokens,
          pricing: { ...meta.pricing },
          capabilities: { ...meta.capabilities },
          recommended_stt_model: meta.recommended_stt_model,
          description: meta.description,
        }));
      }
      return fetchOpenAiCatalog(apiKey, baseUrl);

    case "GEMINI":
      if (!apiKey?.trim()) {
        // Fallback curated Gemini models jika key belum ada
        return Object.entries(GEMINI_CURATED_MODELS).map(([id, meta]) => ({
          id,
          name: meta.name,
          provider: "GEMINI",
          context_length: meta.context_length,
          max_output_tokens: meta.max_output_tokens,
          pricing: { ...meta.pricing },
          capabilities: { ...meta.capabilities },
          recommended_stt_model: meta.recommended_stt_model,
          description: meta.description,
        }));
      }
      return fetchGeminiCatalog(apiKey);

    case "ANTHROPIC":
      return fetchAnthropicCatalog(apiKey);

    case "CUSTOM_OPENAI_COMPAT":
      if (!baseUrl?.trim()) {
        throw new Error(
          "Base URL wajib diisi untuk provider Custom OpenAI Compatible (contoh: http://localhost:11434/v1).",
        );
      }
      return fetchCustomCatalog(baseUrl, apiKey);

    default:
      throw new Error(`Provider "${provider}" tidak didukung.`);
  }
}
