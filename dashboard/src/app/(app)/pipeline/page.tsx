import { getActivePipelineConfig } from "@/lib/pipeline/manager";
import { PRESETS } from "@/lib/pipeline/presets";
import { PipelineStudio } from "./PipelineStudio";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const activePipeline = await getActivePipelineConfig();

  return (
    <PipelineStudio
      initialPipeline={activePipeline}
      presets={PRESETS}
    />
  );
}
