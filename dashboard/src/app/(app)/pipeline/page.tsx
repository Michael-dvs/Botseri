import { getActivePipelineConfig, type ActivePipelineConfig } from "@/lib/pipeline/manager";
import { PRESETS, FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";
import { prisma } from "@/lib/db";
import { PipelineStudio } from "./PipelineStudio";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  let activePipeline: ActivePipelineConfig;
  try {
    activePipeline = await getActivePipelineConfig();
  } catch (err) {
    console.error("Gagal memuat konfigurasi alur aktif dari database, menggunakan fallback preset:", err);
    activePipeline = {
      id: 1,
      name: "Default Florist & Decor",
      preset_key: "FLORIST_DECOR",
      version: 1,
      config: FLORIST_DECOR_PRESET,
    };
  }

  let versions: Array<{
    id: string;
    version: number;
    created_at: Date;
    actor: string;
  }> = [];
  try {
    const rawVersions = await prisma.pipelineConfigVersion.findMany({
      orderBy: { version: "desc" },
      take: 20,
      select: {
        id: true,
        version: true,
        created_at: true,
        actor: true,
      },
    });
    versions = rawVersions.map((v) => ({
      id: v.id,
      version: v.version,
      created_at: v.created_at,
      actor: v.actor || "system",
    }));
  } catch (err) {
    console.error("Gagal memuat riwayat versi alur dari database:", err);
  }

  return (
    <PipelineStudio
      initialPipeline={activePipeline}
      presets={PRESETS}
      initialVersions={versions}
    />
  );
}
