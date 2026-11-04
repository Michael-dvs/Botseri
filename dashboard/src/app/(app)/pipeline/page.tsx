import { getActivePipelineConfig } from "@/lib/pipeline/manager";
import { PRESETS } from "@/lib/pipeline/presets";
import { prisma } from "@/lib/db";
import { PipelineStudio } from "./PipelineStudio";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
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

  return (
    <PipelineStudio
      initialPipeline={activePipeline}
      presets={PRESETS}
      initialVersions={versions}
    />
  );
}
