import { Prisma, type LlmConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";

export type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

export async function recordUsage(input: {
  config: LlmConfig;
  callType: string;
  usage?: TokenUsage;
  latencyMs?: number;
  executionId?: string | null;
  success: boolean;
  error?: string | null;
}) {
  const promptTokens = Math.max(0, Math.trunc(input.usage?.prompt_tokens ?? 0));
  const completionTokens = Math.max(
    0,
    Math.trunc(input.usage?.completion_tokens ?? 0),
  );
  const inputPrice = input.config.price_input_per_mtok;
  const outputPrice = input.config.price_output_per_mtok;
  const cost =
    inputPrice !== null && outputPrice !== null
      ? (promptTokens / 1_000_000) * Number(inputPrice) +
        (completionTokens / 1_000_000) * Number(outputPrice)
      : null;

  await prisma.llmUsageLog.create({
    data: {
      call_type: input.callType.slice(0, 50),
      provider: input.config.provider,
      model: input.config.model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_usd: cost === null ? null : new Prisma.Decimal(cost),
      latency_ms: input.latencyMs ?? null,
      n8n_execution_id: input.executionId?.slice(0, 100) ?? null,
      success: input.success,
      error: input.error?.slice(0, 2000) ?? null,
    },
  });
}

export async function safeRecordUsage(
  input: Parameters<typeof recordUsage>[0],
): Promise<void> {
  try {
    await recordUsage(input);
  } catch (error) {
    log("ERROR", "llm-usage", "failed to record LLM usage", undefined, error);
  }
}
