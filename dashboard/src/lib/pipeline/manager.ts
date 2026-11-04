import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  PipelineConfigSchema,
  type PipelineConfigData,
} from "./schema";
import { FLORIST_DECOR_PRESET, type PresetKey } from "./presets";

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
    let parsedConfig = PipelineConfigSchema.parse(row.config_json);

    // Auto-Heal (Section C): Periksa jika customer_greeting.greeting_text saat ini terlanjur tertimpa
    // kata "katalog" atau link "drive.google.com" / "google.drive.com" dari kontainer sub-menu
    const currentGreeting = (parsedConfig.customer_greeting?.greeting_text || "").toLowerCase();
    const isContaminated =
      currentGreeting.includes("katalog") ||
      currentGreeting.includes("drive.google.com") ||
      currentGreeting.includes("google.drive.com");

    if (isContaminated) {
      let restoredGreeting = FLORIST_DECOR_PRESET.customer_greeting.greeting_text;

      // Cek apakah node-greeting di graph masih memiliki teks selamat datang yang autentik
      if (parsedConfig.graph?.nodes) {
        const rootGreetingNode = parsedConfig.graph.nodes.find((n) => n.id === "node-greeting");
        const nodeText = String(
          rootGreetingNode?.data?.greeting_text || rootGreetingNode?.data?.message_text || ""
        );
        if (
          nodeText.trim().length > 0 &&
          !nodeText.toLowerCase().includes("katalog") &&
          !nodeText.toLowerCase().includes("drive.google.com")
        ) {
          restoredGreeting = nodeText.trim();
        } else if (rootGreetingNode && rootGreetingNode.data) {
          rootGreetingNode.data.greeting_text = restoredGreeting;
          rootGreetingNode.data.message_text = restoredGreeting;
        }
      }

      parsedConfig = {
        ...parsedConfig,
        customer_greeting: {
          ...parsedConfig.customer_greeting,
          greeting_text: restoredGreeting,
        },
      };

      try {
        await prisma.pipelineConfig.update({
          where: { id: row.id },
          data: {
            config_json: parsedConfig as unknown as Prisma.InputJsonValue,
          },
        });
      } catch {
        // Continue gracefully if DB update fails in unit test mock
      }
    }

    return {
      id: row.id,
      name: row.name,
      preset_key: row.preset_key as PresetKey,
      version: row.version,
      config: parsedConfig,
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
