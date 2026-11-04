export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { PipelineConfigSchema } from "@/lib/pipeline/schema";
import { PRESETS } from "@/lib/pipeline/presets";
import { getActivePipelineConfig } from "@/lib/pipeline/manager";

const putSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  preset_key: z.enum(["FLORIST_DECOR", "GENERIC_COMMERCE", "PERSONAL_ASSISTANT"]).optional(),
  config: PipelineConfigSchema,
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const activePipeline = await getActivePipelineConfig();

  return NextResponse.json({
    ok: true,
    pipeline: activePipeline,
    presets: PRESETS,
  });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawJson = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Payload tidak valid", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { name, preset_key, config } = parsed.data;

  const current = await prisma.pipelineConfig.findUnique({ where: { id: 1 } });
  const nextVersion = (current?.version || 1) + 1;

  const updated = await prisma.pipelineConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: name || "Pipeline Operasional Berseri",
      preset_key: preset_key || "FLORIST_DECOR",
      config_json: config as unknown as Prisma.InputJsonValue,
      version: 1,
    },
    update: {
      name: name || current?.name,
      preset_key: preset_key || current?.preset_key,
      config_json: config as unknown as Prisma.InputJsonValue,
      version: nextVersion,
    },
  });

  // Sync enable_orders flag in bot_settings with owner_assistant.enable_order_tools
  if (config.owner_assistant?.enable_order_tools !== undefined) {
    await prisma.botSettings.update({
      where: { id: 1 },
      data: {
        enable_orders: config.owner_assistant.enable_order_tools,
      },
    });
  }

  await recordEvent("INFO", "pipeline", "PIPELINE_UPDATED", {
    version: updated.version,
    preset_key: updated.preset_key,
    name: updated.name,
  });

  return NextResponse.json({
    ok: true,
    pipeline: {
      id: updated.id,
      name: updated.name,
      preset_key: updated.preset_key,
      version: updated.version,
      config,
    },
  });
}
