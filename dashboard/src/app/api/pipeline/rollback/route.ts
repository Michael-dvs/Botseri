export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { PipelineConfigSchema } from "@/lib/pipeline/schema";
import { validateGraph } from "@/lib/pipeline/validate-graph";

const rollbackSchema = z.object({
  version: z.number().int().min(1),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawJson = await request.json().catch(() => null);
  const parsed = rollbackSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Versi tidak valid" },
      { status: 400 }
    );
  }

  const targetVersion = parsed.data.version;
  const historyRow = await prisma.pipelineConfigVersion.findFirst({
    where: { version: targetVersion },
    orderBy: { created_at: "desc" },
  });

  if (!historyRow) {
    return NextResponse.json(
      { ok: false, error: `Versi ${targetVersion} tidak ditemukan di riwayat pipeline.` },
      { status: 404 }
    );
  }

  const restoredConfig = PipelineConfigSchema.parse(historyRow.config_json);

  // Validasi graf sebelum pemulihan (INV-16)
  const validation = validateGraph(restoredConfig.graph);
  if (!validation.valid) {
    return NextResponse.json(
      {
        ok: false,
        error: "Graf pada versi yang dipilih tidak lolos validasi keselamatan.",
        errors: validation.errors,
      },
      { status: 422 }
    );
  }

  const current = await prisma.pipelineConfig.findUnique({ where: { id: 1 } });
  const nextVersion = (current?.version || 1) + 1;

  const updated = await prisma.pipelineConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: current?.name || "Pipeline Operasional Berseri",
      preset_key: current?.preset_key || "FLORIST_DECOR",
      config_json: restoredConfig as unknown as Prisma.InputJsonValue,
      version: nextVersion,
    },
    update: {
      config_json: restoredConfig as unknown as Prisma.InputJsonValue,
      version: nextVersion,
    },
  });

  // Catat baris versi baru di riwayat
  await prisma.pipelineConfigVersion.create({
    data: {
      version: nextVersion,
      config_json: restoredConfig as unknown as Prisma.InputJsonValue,
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

  if (restoredConfig.owner_assistant?.enable_order_tools !== undefined) {
    await prisma.botSettings.update({
      where: { id: 1 },
      data: {
        enable_orders: restoredConfig.owner_assistant.enable_order_tools,
      },
    });
  }

  await recordEvent("INFO", "pipeline", "PIPELINE_ROLLBACK", {
    from_version: targetVersion,
    new_version: updated.version,
    actor: session.username,
  });

  return NextResponse.json({
    ok: true,
    message: `Pipeline berhasil dipulihkan ke versi ${targetVersion} (versi aktif saat ini: ${updated.version}).`,
    pipeline: {
      id: updated.id,
      name: updated.name,
      preset_key: updated.preset_key,
      version: updated.version,
      config: restoredConfig,
    },
  });
}
