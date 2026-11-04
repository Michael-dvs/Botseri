export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

const providers = [
  "OPENAI",
  "OPENROUTER",
  "GEMINI",
  "CUSTOM_OPENAI_COMPAT",
  "ANTHROPIC",
] as const;

const updateSchema = z
  .object({
    provider: z.enum(providers).optional(),
    model: z.string().trim().min(1).max(100).optional(),
    base_url: z.string().url().max(255).nullable().optional(),
    api_key: z.string().min(8).max(4096).optional(),
    stt_model: z.string().trim().max(100).nullable().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_output_tokens: z.number().int().min(1).max(8000).optional(),
    price_input_per_mtok: z.number().nonnegative().nullable().optional(),
    price_output_per_mtok: z.number().nonnegative().nullable().optional(),
    is_active: z.boolean().optional(),
    is_fallback: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "CUSTOM_OPENAI_COMPAT" && value.base_url === null) {
      ctx.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "base_url wajib untuk CUSTOM_OPENAI_COMPAT",
      });
    }
  });

const uuidSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json(
      { ok: false, error: "konfigurasi tidak ditemukan" },
      { status: 404 },
    );
  }

  const parsed = updateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      if (input.is_active) {
        await tx.llmConfig.updateMany({ data: { is_active: false } });
      }
      if (input.is_fallback) {
        await tx.llmConfig.updateMany({
          where: { id: { not: params.id } },
          data: { is_fallback: false },
        });
      }
      await tx.llmConfig.update({
        where: { id: params.id },
        data: {
          provider: input.provider,
          model: input.model,
          base_url: input.base_url,
          api_key_enc: input.api_key
            ? encryptSecret(input.api_key, "llm_configs.api_key_enc")
            : undefined,
          stt_model: input.stt_model,
          temperature: input.temperature,
          max_output_tokens: input.max_output_tokens,
          price_input_per_mtok: input.price_input_per_mtok,
          price_output_per_mtok: input.price_output_per_mtok,
          is_active: input.is_active,
          is_fallback: input.is_fallback,
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { ok: false, error: "konfigurasi tidak ditemukan" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Gagal memperbarui konfigurasi LLM" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json(
      { ok: false, error: "konfigurasi tidak ditemukan" },
      { status: 404 },
    );
  }
  const deleted = await prisma.llmConfig.deleteMany({
    where: { id: params.id },
  });
  if (deleted.count === 0) {
    return NextResponse.json(
      { ok: false, error: "konfigurasi tidak ditemukan" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
