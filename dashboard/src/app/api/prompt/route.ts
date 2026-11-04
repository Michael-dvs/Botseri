export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { compileSystemPrompt } from "@/lib/prompt/compiler";

const schema = z.object({
  prompt_mode: z.enum(["STACK", "CUSTOM"]),
  custom_prompt_template: z.string().max(40000).nullable().optional(),
});

export async function GET() {
  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });
  return NextResponse.json({
    ok: true,
    prompt_mode: settings.prompt_mode,
    custom_prompt_template: settings.custom_prompt_template,
    compiled_prompt: settings.compiled_prompt,
    compiled_prompt_version: settings.compiled_prompt_version,
    compiled_at: settings.compiled_at,
  });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "payload tidak valid" },
      { status: 400 },
    );
  }
  if (
    parsed.data.prompt_mode === "CUSTOM" &&
    !parsed.data.custom_prompt_template?.trim()
  ) {
    return NextResponse.json(
      { ok: false, error: "template CUSTOM wajib diisi" },
      { status: 400 },
    );
  }

  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });
  const levels = await prisma.priorityLevel.findMany({
    orderBy: { rank: "asc" },
  });

  let compiled;
  try {
    compiled = compileSystemPrompt(
      {
        ...settings,
        prompt_mode: parsed.data.prompt_mode,
        custom_prompt_template:
          parsed.data.custom_prompt_template ?? null,
      },
      levels,
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "kompilasi gagal",
      },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.botSettings.update({
      where: { id: 1 },
      data: {
        prompt_mode: parsed.data.prompt_mode,
        custom_prompt_template:
          parsed.data.custom_prompt_template ?? null,
        compiled_prompt: compiled.prompt,
        compiled_prompt_version: compiled.version,
        compiled_at: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      warnings: compiled.warnings,
      compiled_prompt: updated.compiled_prompt,
      compiled_prompt_version: updated.compiled_prompt_version,
      compiled_at: updated.compiled_at,
    });
  } catch (error) {
    log("ERROR", "api.prompt", "save failed", undefined, error);
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan prompt" },
      { status: 500 },
    );
  }
}
