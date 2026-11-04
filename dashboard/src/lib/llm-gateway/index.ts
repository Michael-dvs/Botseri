import { z } from "zod";
import type { LlmConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { callAnthropic, anthropicToOpenAi } from "./anthropic";
import { callGemini, geminiToOpenAi } from "./gemini";
import { callOpenAiCompatible, type ChatPayload } from "./openai-compatible";

export class NoActiveLlmError extends Error {
  constructor() {
    super("LLM aktif belum dikonfigurasi");
    this.name = "NoActiveLlmError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly config: LlmConfig,
    readonly provider: string,
    readonly latencyMs: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const errorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({ message: z.string() }).passthrough(),
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

export async function chatCompletion(payload: ChatPayload, signal?: AbortSignal) {
  const config = await getActiveConfig();
  const apiKey = decryptSecret(config.api_key_enc, "llm_configs.api_key_enc");
  const provider = config.provider;
  const started = Date.now();

  let response: Response;
  try {
    response =
      provider === "ANTHROPIC"
        ? await callAnthropic(config, apiKey, payload, signal)
        : provider === "GEMINI"
          ? await callGemini(config, apiKey, payload, signal)
          : await callOpenAiCompatible(config, apiKey, payload, signal);
  } catch (error) {
    const isTimeout =
      (error instanceof Error && (error.name === "TimeoutError" || error.message.includes("timeout"))) ||
      signal?.aborted;
    const status = isTimeout ? 504 : 502;
    const message = isTimeout
      ? "Upstream provider timeout"
      : error instanceof Error
        ? error.message
        : "Provider gagal";
    throw new ProviderError(message, status, config, provider, Date.now() - started);
  }

  const latencyMs = Date.now() - started;
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ProviderError(
      "Respons provider bukan JSON",
      502,
      config,
      provider,
      latencyMs,
    );
  }

  if (!response.ok) {
    throw new ProviderError(
      upstreamMessage(raw, `Provider HTTP ${response.status}`),
      response.status >= 400 && response.status <= 599 ? response.status : 502,
      config,
      provider,
      latencyMs,
    );
  }

  const body =
    provider === "ANTHROPIC"
      ? anthropicToOpenAi(raw)
      : provider === "GEMINI"
        ? geminiToOpenAi(raw)
        : raw;
  return { body, config, provider, latencyMs };
}
