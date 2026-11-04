export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { PRESETS, type PresetKey } from "@/lib/pipeline/presets";

const resetSchema = z.object({
  preset_key: z.enum(["FLORIST_DECOR", "GENERIC_COMMERCE", "PERSONAL_ASSISTANT"]),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawJson = await request.json().catch(() => null);
  const parsed = resetSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Preset tidak valid" },
      { status: 400 }
    );
  }

  const presetDef = PRESETS[parsed.data.preset_key as PresetKey];
  if (!presetDef) {
    return NextResponse.json(
      { ok: false, error: "Preset tidak ditemukan" },
      { status: 404 }
    );
  }

  const current = await prisma.pipelineConfig.findUnique({ where: { id: 1 } });
  const nextVersion = (current?.version || 1) + 1;

  const updated = await prisma.pipelineConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: presetDef.name,
      preset_key: presetDef.key,
      config_json: presetDef.config as unknown as Prisma.InputJsonValue,
      version: 1,
    },
    update: {
      name: presetDef.name,
      preset_key: presetDef.key,
      config_json: presetDef.config as unknown as Prisma.InputJsonValue,
      version: nextVersion,
    },
  });

  // Sync enable_orders with owner_assistant.enable_order_tools
  await prisma.botSettings.update({
    where: { id: 1 },
    data: {
      enable_orders: presetDef.config.owner_assistant.enable_order_tools,
    },
  });

  await recordEvent("INFO", "pipeline", "PIPELINE_RESET", {
    version: updated.version,
    preset_key: presetDef.key,
  });

  return NextResponse.json({
    ok: true,
    pipeline: {
      id: updated.id,
      name: updated.name,
      preset_key: updated.preset_key,
      version: updated.version,
      config: presetDef.config,
    },
  });
}
