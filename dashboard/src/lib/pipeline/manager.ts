import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  PipelineConfigSchema,
  type PipelineConfigData,
} from "./schema";
import { FLORIST_DECOR_PRESET, type PresetKey } from "./presets";
import { projectCoreConfig } from "./projector";

export interface ActivePipelineConfig {
  id: number;
  name: string;
  preset_key: PresetKey;
  version: number;
  config: PipelineConfigData;
}

/**
 * Returns the currently active pipeline configuration from the database.
 * If no configuration exists, automatically seeds the FLORIST_DECOR preset.
 */
export async function getActivePipelineConfig(): Promise<ActivePipelineConfig> {
  try {
    const row = await prisma.pipelineConfig.findUnique({
      where: { id: 1 },
    });

    if (!row) {
      try {
        const created = await prisma.pipelineConfig.upsert({
          where: { id: 1 },
          create: {
            id: 1,
            name: "Pipeline Operasional Berseri",
            preset_key: "FLORIST_DECOR",
            config_json: FLORIST_DECOR_PRESET as unknown as Prisma.InputJsonValue,
            version: 1,
          },
          update: {},
        });

        if (created) {
          return {
            id: created.id,
            name: created.name,
            preset_key: created.preset_key as PresetKey,
            version: created.version,
            config: PipelineConfigSchema.parse(created.config_json),
          };
        }
      } catch {
        // Fallback to preset if DB upsert fails in mock
      }

      return {
        id: 1,
        name: "Pipeline Operasional Berseri",
        preset_key: "FLORIST_DECOR",
        version: 1,
        config: FLORIST_DECOR_PRESET,
      };
    }

    // Safely parse JSON with fallback to defaults for forward-compatibility
    const rawParsed = PipelineConfigSchema.parse(row.config_json);

    // Single Source of Truth (SSOT): Turunkan 6 kontainer inti secara dinamis dari graf visual
    const projectedConfig = rawParsed.graph?.nodes?.length
      ? projectCoreConfig(rawParsed.graph, rawParsed)
      : rawParsed;

    return {
      id: row.id,
      name: row.name,
      preset_key: row.preset_key as PresetKey,
      version: row.version,
      config: projectedConfig,
    };
  } catch {
    return {
      id: 1,
      name: "Pipeline Operasional Berseri",
      preset_key: "FLORIST_DECOR",
      version: 1,
      config: FLORIST_DECOR_PRESET,
    };
  }
}

/**
 * Replaces {{placeholder}} tokens with values provided in vars map.
 * Replaces any em dash with a standard middle dot per antislop guidelines.
 */
export function renderPipelineTemplate(
  template: string,
  vars: Record<string, string | null | undefined>
): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    const replacement = val !== undefined && val !== null ? String(val) : "-";
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    result = result.replace(regex, replacement);
  }

  // Replace any unpopulated {{...}} placeholders with "-"
  result = result.replace(/\{\{\s*[\w_]+\s*\}\}/g, "-");

  // Enforce antislop rule: strip em dashes cleanly
  result = result.replace(/\s*—\s*/g, " · ");

  return result.trim();
}
