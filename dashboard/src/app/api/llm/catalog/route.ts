export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { fetchModelCatalog, type LlmProviderType } from "@/lib/llm-gateway/catalog";

const providers = [
  "OPENROUTER",
  "OPENAI",
  "GEMINI",
  "ANTHROPIC",
  "CUSTOM_OPENAI_COMPAT",
] as const;

const requestSchema = z.object({
  provider: z.enum(providers),
  api_key: z.string().trim().optional(),
  base_url: z.string().trim().optional(),
  use_saved_key: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  // 1. Validasi sesi admin
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validasi body JSON
  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Format request JSON tidak valid." },
      { status: 400 },
    );
  }

  const parseResult = requestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues[0]?.message || "Input tidak valid.";
    return NextResponse.json({ ok: false, error: errorMsg }, { status: 400 });
  }

  const { provider, use_saved_key } = parseResult.data;
  let apiKey = parseResult.data.api_key || "";
  let baseUrl = parseResult.data.base_url || "";

  // 3. Ambil dan dekripsi API key / Base URL tersimpan jika use_saved_key = true
  if (use_saved_key) {
    try {
      const savedConfig = await prisma.llmConfig.findFirst({
        where: { provider },
        orderBy: [{ is_active: "desc" }, { updated_at: "desc" }],
      });

      if (savedConfig) {
        if (!apiKey && savedConfig.api_key_enc) {
          apiKey = decryptSecret(savedConfig.api_key_enc, "llm_configs.api_key_enc");
        }
        if (!baseUrl && savedConfig.base_url) {
          baseUrl = savedConfig.base_url;
        }
      }
    } catch (dbError) {
      console.error("Gagal membaca atau mendekripsi kunci tersimpan:", dbError);
      // Lanjutkan dengan kunci yang ada bila dekripsi gagal
    }
  }

  // 4. Tarik katalog model dari provider
  try {
    const models = await fetchModelCatalog({
      provider: provider as LlmProviderType,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    });

    return NextResponse.json({
      ok: true,
      provider,
      count: models.length,
      models,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Terjadi kesalahan saat menarik katalog model dari provider.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 502 },
    );
  }
}
