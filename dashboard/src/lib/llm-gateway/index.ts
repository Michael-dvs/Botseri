import { z } from "zod";
import type { LlmConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { recordEvent } from "@/lib/events";
import { callAnthropic, anthropicToOpenAi } from "./anthropic";
import { callGemini, geminiToOpenAi } from "./gemini";
import { callOpenAiCompatible, type ChatPayload } from "./openai-compatible";
import {
  NoActiveLlmError,
  ProviderError,
  OutputTruncatedError,
  type ProviderErrorKind,
} from "./errors";

export {
  NoActiveLlmError,
  ProviderError,
  OutputTruncatedError,
  type ProviderErrorKind,
};

const errorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({
      message: z.string(),
    }),
  ]),
});

function upstreamMessage(raw: unknown, fallback: string): string {
  const parsed = errorSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  return typeof parsed.data.error === "string"
    ? parsed.data.error
    : parsed.data.error.message;
}

export async function getActiveConfig(): Promise<LlmConfig> {
  const config = await prisma.llmConfig.findFirst({
    where: { is_active: true },
    orderBy: { updated_at: "desc" },
  });
  if (!config) throw new NoActiveLlmError();
  return config;
}

export async function getFallbackConfig(): Promise<LlmConfig | null> {
  return prisma.llmConfig.findFirst({
    where: { is_fallback: true, is_active: true },
  });
}

async function dispatchProviderCall(
  config: LlmConfig,
  payload: ChatPayload,
  signal?: AbortSignal,
): Promise<Response> {
  const apiKey = decryptSecret(config.api_key_enc, "llm_configs.api_key_enc");
  const provider = config.provider;

  if (provider === "ANTHROPIC") {
    return callAnthropic(config, apiKey, payload, signal);
  }
  if (provider === "GEMINI") {
    return callGemini(config, apiKey, payload, signal);
  }
  return callOpenAiCompatible(config, apiKey, payload, signal);
}
export async function chatCompletion(
  payload: ChatPayload,
  signal?: AbortSignal,
  targetConfig?: LlmConfig,
) {
  const activeConfig = targetConfig ?? (await getActiveConfig());

  // Helper untuk memanggil provider dengan 1x retry jika 429 atau 5xx
  async function callWithRetry(targetConfig: LlmConfig): Promise<{ response: Response; latencyMs: number }> {
    const started = Date.now();
    let res = await dispatchProviderCall(targetConfig, payload, signal);

    if (res.status === 429 || (res.status >= 500 && res.status <= 504)) {
      const retryHeader = res.headers.get("retry-after");
      const retrySeconds = retryHeader ? parseFloat(retryHeader) : 1;

      // Jika Retry-After <= 5 detik, tunggu dan coba 1x lagi
      if (!isNaN(retrySeconds) && retrySeconds <= 5) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(100, retrySeconds * 1000)));
        res = await dispatchProviderCall(targetConfig, payload, signal);
      }
    }

    return { response: res, latencyMs: Date.now() - started };
  }

  let chosenConfig = activeConfig;
  let response: Response;
  let latencyMs = 0;

  try {
    const primaryResult = await callWithRetry(activeConfig);
    response = primaryResult.response;
    latencyMs = primaryResult.latencyMs;

    // Jika primary model gagal (429 atau 5xx) setelah retry, coba failover ke model fallback
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      const fallback = await getFallbackConfig();
      if (fallback && fallback.id !== activeConfig.id) {
        const errorText = await response.text().catch(() => "");
        void recordEvent("WARN", "llm-gateway", "LLM_FALLBACK_TRIGGERED", {
          primary_model: activeConfig.model,
          fallback_model: fallback.model,
          primary_status: response.status,
          reason: errorText.slice(0, 300),
        });

        const fallbackResult = await callWithRetry(fallback);
        if (fallbackResult.response.ok) {
          chosenConfig = fallback;
          response = fallbackResult.response;
          latencyMs = fallbackResult.latencyMs;
        }
      }
    }
  } catch (error) {
    // Jika network timeout atau fetch gagal pada primary model, coba fallback
    const fallback = await getFallbackConfig();
    if (fallback && fallback.id !== activeConfig.id) {
      void recordEvent("WARN", "llm-gateway", "LLM_FALLBACK_TRIGGERED", {
        primary_model: activeConfig.model,
        fallback_model: fallback.model,
        reason: error instanceof Error ? error.message : String(error),
      });

      const fallbackResult = await callWithRetry(fallback);
      chosenConfig = fallback;
      response = fallbackResult.response;
      latencyMs = fallbackResult.latencyMs;
    } else {
      throw error;
    }
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    const text = await response.text().catch(() => "");
    throw new ProviderError(
      `Invalid JSON from upstream (${chosenConfig.provider}): ${text.slice(0, 150)}`,
      response.status,
      chosenConfig,
      chosenConfig.provider,
      latencyMs,
    );
  }

  if (!response.ok) {
    throw new ProviderError(
      upstreamMessage(raw, `Upstream provider error: HTTP ${response.status}`),
      response.status,
      chosenConfig,
      chosenConfig.provider,
      latencyMs,
    );
  }

  const body =
    chosenConfig.provider === "ANTHROPIC"
      ? anthropicToOpenAi(raw)
      : chosenConfig.provider === "GEMINI"
        ? geminiToOpenAi(raw)
        : raw;

  // Deteksi Output Terpotong (finish_reason: "length" atau "MAX_TOKENS")
  const rawBodyObj = body as Record<string, unknown>;
  const choices = Array.isArray(rawBodyObj.choices) ? (rawBodyObj.choices as Array<Record<string, unknown>>) : [];
  const choice = choices[0];
  const finishReason = choice?.finish_reason;

  if (finishReason === "length" || finishReason === "MAX_TOKENS") {
    const message = (choice?.message as Record<string, unknown>) || {};
    const textContent = typeof message.content === "string" ? message.content.trim() : "";
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    // Jika terpotong dan konten teks kosong atau terputus tanpa tool call
    if (!textContent && toolCalls.length === 0) {
      void recordEvent("WARN", "llm-gateway", "LLM_TRUNCATED", {
        model: chosenConfig.model,
        provider: chosenConfig.provider,
        token_limit: payload.max_tokens ?? chosenConfig.max_output_tokens,
      });

      throw new OutputTruncatedError(chosenConfig.model, payload.max_tokens ?? chosenConfig.max_output_tokens);
    }
  }

  return { body, config: chosenConfig, provider: chosenConfig.provider, latencyMs };
}
