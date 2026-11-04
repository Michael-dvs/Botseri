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
import { validateGraph } from "@/lib/pipeline/validate-graph";

const putSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  preset_key: z.enum(["FLORIST_DECOR", "GENERIC_COMMERCE", "PERSONAL_ASSISTANT"]).optional(),
  expected_version: z.number().int().min(1),
  config: PipelineConfigSchema,
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const activePipeline = await getActivePipelineConfig();

  const versions = await prisma.pipelineConfigVersion.findMany({
    orderBy: { version: "desc" },
    take: 20,
    select: {
      id: true,
      version: true,
      created_at: true,
      actor: true,
    },
  });

  return NextResponse.json({
    ok: true,
    pipeline: activePipeline,
    presets: PRESETS,
    versions,
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

  const { name, preset_key, expected_version, config } = parsed.data;

  // 1. Validasi Graf Pipeline (INV-16)
  const validation = validateGraph(config.graph);
  if (!validation.valid) {
    return NextResponse.json(
      {
        ok: false,
        error: "Graf pipeline tidak valid",
        errors: validation.errors,
        warnings: validation.warnings,
      },
      { status: 422 }
    );
  }

  // 2. Kontrol Versi Optimistik
  const current = await prisma.pipelineConfig.findUnique({ where: { id: 1 } });
  if (current && current.version !== expected_version) {
    return NextResponse.json(
      {
        ok: false,
        error: "Konflik versi pipeline. Konfigurasi telah diubah oleh sesi lain. Silakan muat ulang halaman.",
        current_version: current.version,
        expected_version: expected_version,
      },
      { status: 409 }
    );
  }

  const nextVersion = (current?.version || 1) + 1;

  const updated = await prisma.pipelineConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: name || "Pipeline Operasional Berseri",
      preset_key: preset_key || "FLORIST_DECOR",
      config_json: config as unknown as Prisma.InputJsonValue,
      version: nextVersion,
    },
    update: {
      name: name || current?.name,
      preset_key: preset_key || current?.preset_key,
      config_json: config as unknown as Prisma.InputJsonValue,
      version: nextVersion,
    },
  });

  // Simpan riwayat versi ke pipeline_config_versions
  await prisma.pipelineConfigVersion.create({
    data: {
      version: nextVersion,
      config_json: config as unknown as Prisma.InputJsonValue,
      actor: session.username || "owner",
    },
  });

  // Bersihkan riwayat lama: simpan maksimal 20 versi terakhir
  const oldVersions = await prisma.pipelineConfigVersion.findMany({
    orderBy: { created_at: "desc" },
    skip: 20,
    select: { id: true },
  });
  if (oldVersions.length > 0) {
    await prisma.pipelineConfigVersion.deleteMany({
      where: { id: { in: oldVersions.map((v) => v.id) } },
    });
  }

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
    actor: session.username,
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
    warnings: validation.warnings,
  });
}
