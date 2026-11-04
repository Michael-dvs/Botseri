export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

const providers = [
  "OPENAI",
  "OPENROUTER",
  "GEMINI",
  "CUSTOM_OPENAI_COMPAT",
  "ANTHROPIC",
] as const;

const schema = z
  .object({
    provider: z.enum(providers),
    model: z.string().trim().min(1).max(100),
    base_url: z.string().url().max(255).nullable().optional(),
    api_key: z.string().min(8).max(4096),
    stt_model: z.string().trim().max(100).nullable().optional(),
    temperature: z.number().min(0).max(2).default(0.3),
    max_output_tokens: z.number().int().min(1).max(8000).default(1000),
    price_input_per_mtok: z.number().nonnegative().nullable().optional(),
    price_output_per_mtok: z.number().nonnegative().nullable().optional(),
    is_active: z.boolean().default(true),
    is_fallback: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "CUSTOM_OPENAI_COMPAT" && !value.base_url) {
      ctx.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "base_url wajib untuk CUSTOM_OPENAI_COMPAT",
      });
    }
  });

type ConfigRow = {
  id: string;
  provider: string;
  model: string;
  base_url: string | null;
  stt_model: string | null;
  temperature: number;
  max_output_tokens: number;
  price_input_per_mtok: unknown;
  price_output_per_mtok: unknown;
  is_active: boolean;
  is_fallback: boolean;
  api_key_enc: string;
};

function toPublic(config: ConfigRow) {
  return {
    id: config.id,
    provider: config.provider,
    model: config.model,
    base_url: config.base_url,
    stt_model: config.stt_model,
    temperature: config.temperature,
    max_output_tokens: config.max_output_tokens,
    price_input_per_mtok:
      config.price_input_per_mtok === null
        ? null
        : Number(config.price_input_per_mtok),
    price_output_per_mtok:
      config.price_output_per_mtok === null
        ? null
        : Number(config.price_output_per_mtok),
    is_active: config.is_active,
    is_fallback: Boolean(config.is_fallback),
    has_api_key: config.api_key_enc.length > 0,
  };
}

export async function GET() {
  const configs = await prisma.llmConfig.findMany({
    orderBy: [{ is_active: "desc" }, { updated_at: "desc" }],
  });
  return NextResponse.json({ ok: true, configs: configs.map(toPublic) });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    const config = await prisma.$transaction(async (tx) => {
      if (input.is_active) {
        await tx.llmConfig.updateMany({ data: { is_active: false } });
      }
      if (input.is_fallback) {
        await tx.llmConfig.updateMany({ data: { is_fallback: false } });
      }
      return tx.llmConfig.create({
        data: {
          provider: input.provider,
          model: input.model,
          base_url: input.base_url ?? null,
          api_key_enc: encryptSecret(input.api_key, "llm_configs.api_key_enc"),
          stt_model: input.stt_model ?? null,
          temperature: input.temperature,
          max_output_tokens: input.max_output_tokens,
          price_input_per_mtok: input.price_input_per_mtok ?? null,
          price_output_per_mtok: input.price_output_per_mtok ?? null,
          is_active: input.is_active,
          is_fallback: input.is_fallback,
        } satisfies Prisma.LlmConfigCreateInput,
      });
    });
    return NextResponse.json({ ok: true, id: config.id });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan konfigurasi LLM" },
      { status: 500 },
    );
  }
}
