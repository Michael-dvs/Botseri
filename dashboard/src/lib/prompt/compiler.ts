import fs from "node:fs";
import path from "node:path";
import type {
  BotSettings,
  PriorityLevel,
  PrismaClient,
} from "@prisma/client";

const TEMPLATE_DIR =
  process.env.PROMPT_TEMPLATE_DIR ??
  path.join(process.cwd(), "src/lib/prompt/templates");

const COMPILE_PLACEHOLDERS: Record<string, true> = {
  brand_name: true,
  business_type: true,
  timezone: true,
  work_hours_start: true,
  work_hours_end: true,
  early_brief_time: true,
  behavior_mode: true,
  behavior_instruction: true,
  compiled_priority_stack: true,
};

const RUNTIME_PLACEHOLDERS: Record<string, true> = {
  current_datetime: true,
  trigger_type: true,
  active_todos: true,
  untimed_recent_todos: true,
  daily_stats: true,
  calendar_events_today: true,
  recent_messages: true,
};

export type CompileResult = {
  prompt: string;
  version: number;
  warnings: string[];
};

export function buildPriorityStackText(levels: PriorityLevel[]): string {
  return levels
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map(
      (level) =>
        `${level.rank}. ${level.label}: ${level.rule_text}${level.description ? ` (${level.description})` : ""}`,
    )
    .join("\n");
}

export function normalizeAliases(template: string): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) => {
    if (name === "priority_stack") return "{{compiled_priority_stack}}";
    if (name === "behavior") return "{{behavior_instruction}}";
    if (name === "work_hours") {
      return "{{work_hours_start}} s/d {{work_hours_end}}";
    }
    return match;
  });
}

export function validatePlaceholders(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of Array.from(
    template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g),
  )) {
    const name = match[1];
    if (
      COMPILE_PLACEHOLDERS[name] !== true &&
      RUNTIME_PLACEHOLDERS[name] !== true
    ) {
      unknown.add(name);
    }
  }
  return Array.from(unknown);
}

export function compileSystemPrompt(
  settings: BotSettings,
  levels: PriorityLevel[],
): CompileResult {
  const warnings: string[] = [];
  const source =
    settings.prompt_mode === "CUSTOM" && settings.custom_prompt_template
      ? normalizeAliases(settings.custom_prompt_template)
      : normalizeAliases(
          fs.readFileSync(path.join(TEMPLATE_DIR, "base.id.md"), "utf8"),
        );

  const unknown = validatePlaceholders(source);
  if (unknown.length > 0) {
    throw new Error(`placeholder tidak dikenal: ${unknown.join(", ")}`);
  }

  if (!source.includes("{{compiled_priority_stack}}")) {
    warnings.push("template CUSTOM tidak memuat {{compiled_priority_stack}}");
  }

  const values: Record<string, string> = {
    brand_name: settings.brand_name,
    business_type: settings.business_type,
    timezone: settings.timezone,
    work_hours_start: settings.work_hours_start,
    work_hours_end: settings.work_hours_end,
    early_brief_time: settings.early_brief_time,
    behavior_mode: settings.behavior_mode,
    behavior_instruction: settings.behavior_instruction ?? "",
    compiled_priority_stack: buildPriorityStackText(levels),
  };

  let prompt = source.replace(
    /\{\{\s*([a-z_]+)\s*\}\}/g,
    (match, name: string) => {
      if (name in values) return values[name];
      return match;
    },
  );

  if (settings.enable_orders === false) {
    prompt = prompt
      .replace(
        "mencatat pesanan, dan mengelola tenggat tugas agar tidak ada yang terlewat.",
        "dan mengelola tenggat tugas agar tidak ada yang terlewat.",
      )
      .replace(
        "Jika pesan memuat pesanan pelanggan, panggil tool_create_todo_and_order. Pecah pesanan menjadi to-do operasional konkret (belanja, produksi, pengiriman, penagihan) hanya bila informasinya disebut.",
        "Catat to-do operasional konkret dari pesan pengguna menggunakan tool_create_todo_and_order tanpa parameter pesanan.",
      );
  }

  return {
    prompt,
    version: settings.compiled_prompt_version + 1,
    warnings,
  };
}
export async function compileAndStore(
  prismaClient: Pick<PrismaClient, "priorityLevel" | "botSettings">,
  settings: BotSettings,
): Promise<CompileResult> {
  const levels = await prismaClient.priorityLevel.findMany();
  const result = compileSystemPrompt(settings, levels);
  await prismaClient.botSettings.update({
    where: { id: 1 },
    data: {
      compiled_prompt: result.prompt,
      compiled_prompt_version: result.version,
      compiled_at: new Date(),
    },
  });
  return result;
}
