import { setTimeout as delay } from "node:timers/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternal } from "@/lib/internal/auth";
import { decryptSecret } from "@/lib/crypto";
import { getActiveConfig } from "@/lib/llm-gateway";
import { openAiBaseUrl } from "@/lib/llm-gateway/openai-compatible";
import { safeRecordUsage } from "@/lib/llm-gateway/usage";
import { log } from "@/lib/logger";

const MAX_BYTES = 5 * 1024 * 1024;
const responseSchema = z.object({ text: z.string() }).passthrough();

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getActiveConfig().catch(() => null);
  if (!config) {
    return NextResponse.json(
      { error: "LLM aktif belum dikonfigurasi" },
      { status: 503 },
    );
  }
  if (config.provider === "ANTHROPIC") {
    return NextResponse.json(
      { error: "Provider Anthropic tidak mendukung STT di gateway ini" },
      { status: 400 },
    );
  }

  const incoming = await request.formData().catch(() => null);
  const file = incoming?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "File audio wajib dikirim" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Ukuran audio maksimal 5 MB" }, { status: 413 });
  }

  const started = Date.now();
  const callType =
    request.headers.get("x-botseri-call-type")?.trim().slice(0, 50) ??
    "transcription";
  const executionId =
    request.headers.get("x-botseri-execution-id")?.trim().slice(0, 100) ?? null;

  try {
    const apiKey = decryptSecret(config.api_key_enc, "llm_configs.api_key_enc");
    const form = new FormData();
    const name = "name" in file && typeof file.name === "string"
      ? file.name
      : "audio.ogg";
    form.append("file", file, name);
    form.append("model", config.stt_model ?? "whisper-1");
    form.append("response_format", "json");

    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetch(`${openAiBaseUrl(config)}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status !== 429 && response.status < 500) break;
      await response.body?.cancel();
      if (attempt === 0) await delay(500);
    }

    const latencyMs = Date.now() - started;
    if (!response?.ok) {
      const failure = `Provider STT HTTP ${response?.status ?? "tidak diketahui"}`;
      await safeRecordUsage({
        config,
        callType,
        latencyMs,
        executionId,
        success: false,
        error: failure,
      });
      return NextResponse.json({ error: failure }, { status: 502 });
    }

    const raw: unknown = await response.json().catch(() => null);
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      await safeRecordUsage({
        config,
        callType,
        latencyMs,
        executionId,
        success: false,
        error: "Respons STT tidak valid",
      });
      return NextResponse.json(
        { error: "Respons STT tidak valid" },
        { status: 502 },
      );
    }

    await safeRecordUsage({
      config,
      callType,
      latencyMs,
      executionId,
      success: true,
    });
    return NextResponse.json({ text: parsed.data.text });
  } catch (error) {
    log("ERROR", "llm-stt", "transcription failed", undefined, error);
    await safeRecordUsage({
      config,
      callType,
      latencyMs: Date.now() - started,
      executionId,
      success: false,
      error: error instanceof Error ? error.message : "STT gagal",
    });
    return NextResponse.json(
      { error: "Transkripsi gagal diproses" },
      { status: 502 },
    );
  }
}
