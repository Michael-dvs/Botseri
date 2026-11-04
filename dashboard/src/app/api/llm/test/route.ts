export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { callOpenAiCompatible } from "@/lib/llm-gateway/openai-compatible";
import { callAnthropic } from "@/lib/llm-gateway/anthropic";

const schema = z.object({ config_id: z.string().uuid().optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "payload tidak valid" },
      { status: 400 },
    );
  }

  const config = parsed.data.config_id
    ? await prisma.llmConfig.findUnique({
        where: { id: parsed.data.config_id },
      })
    : await prisma.llmConfig.findFirst({
        where: { is_active: true },
        orderBy: { updated_at: "desc" },
      });
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "konfigurasi LLM tidak ditemukan" },
      { status: 404 },
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(config.api_key_enc, "llm_configs.api_key_enc");
  } catch {
    return NextResponse.json(
      { ok: false, error: "API key tidak dapat didekripsi" },
      { status: 422 },
    );
  }

  // Tes dibuat semurah mungkin: token dan temperature ditimpa.
  const testConfig = {
    ...config,
    temperature: 0,
    max_output_tokens: Math.min(config.max_output_tokens, 16),
  };
  const payload = {
    messages: [{ role: "user", content: "Balas satu kata: ok" }],
  };

  const startedAt = Date.now();
  try {
    const response =
      config.provider === "ANTHROPIC"
        ? await callAnthropic(testConfig, apiKey, payload)
        : await callOpenAiCompatible(testConfig, apiKey, payload);
    const latencyMs = Date.now() - startedAt;
    const raw = await response.text();
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      latency_ms: latencyMs,
      sample: raw.slice(0, 300),
      error: response.ok ? null : raw.slice(0, 300),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
