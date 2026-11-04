import { describe, expect, it } from "vitest";
import type { BotSettings, PriorityLevel } from "@prisma/client";
import {
  compileSystemPrompt,
  validatePlaceholders,
} from "../../src/lib/prompt/compiler";
import {
  renderPrompt,
  selectTriggerBlock,
  type RuntimeContext,
} from "../../src/lib/prompt/render";

const settings = {
  id: 1,
  brand_name: "Buket Mawar",
  business_type: "florist",
  owner_name: "Ani",
  timezone: "Asia/Jakarta",
  work_hours_start: "08:00",
  work_hours_end: "17:00",
  early_brief_time: "06:00",
  working_days: [1, 2, 3, 4, 5, 6],
  behavior_mode: "STRICT",
  behavior_instruction: "Tegas.",
  prompt_mode: "STACK",
  custom_prompt_template: null,
  compiled_prompt: null,
  compiled_prompt_version: 1,
  compiled_at: null,
  reminder_interval_minutes: 120,
  reminder_max_per_day: 5,
  reminder_max_rank: 2,
  brief_window_minutes: 120,
  eod_window_minutes: 120,
  default_due_time: "17:00",
  google_sync_mode: "AUTO",
  enable_orders: true,
  bot_enabled: true,
  setup_completed: false,
  created_at: new Date(),
  updated_at: new Date(),
} as BotSettings;

const levels = [
  {
    id: "level-1",
    rank: 1,
    label: "Pesanan pelanggan",
    description: "Tenggat hari ini",
    rule_text: "Kerjakan lebih dulu.",
    color: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
] as PriorityLevel[];

describe("prompt compiler", () => {
  it("replaces compile placeholders and preserves runtime placeholders", () => {
    const result = compileSystemPrompt(settings, levels);
    expect(result.version).toBe(2);
    expect(result.prompt).toContain("Buket Mawar");
    expect(result.prompt).toContain("1. Pesanan pelanggan");
    expect(result.prompt).not.toContain("{{brand_name}}");
    expect(result.prompt).toContain("{{current_datetime}}");
  });

  it("normalizes custom aliases and warns without a priority stack", () => {
    const result = compileSystemPrompt(
      {
        ...settings,
        prompt_mode: "CUSTOM",
        custom_prompt_template: "Halo {{brand_name}}; jam {{work_hours}}.",
      },
      levels,
    );
    expect(result.prompt).toBe("Halo Buket Mawar; jam 08:00 s/d 17:00.");
    expect(result.warnings).toHaveLength(1);
  });

  it("rejects unknown placeholders", () => {
    expect(validatePlaceholders("{{unknown_thing}}")).toEqual([
      "unknown_thing",
    ]);
    expect(() =>
      compileSystemPrompt(
        {
          ...settings,
          prompt_mode: "CUSTOM",
          custom_prompt_template: "{{unknown_thing}}",
        },
        levels,
      ),
    ).toThrow("placeholder tidak dikenal");
  });

  it("adapts order instructions when enable_orders is false vs true", () => {
    const withOrders = compileSystemPrompt(
      { ...settings, enable_orders: true },
      levels,
    );
    expect(withOrders.prompt).toContain("mencatat pesanan");
    expect(withOrders.prompt).toContain("Jika pesan memuat pesanan pelanggan, panggil tool_create_todo_and_order");

    const withoutOrders = compileSystemPrompt(
      { ...settings, enable_orders: false },
      levels,
    );
    expect(withoutOrders.prompt).not.toContain("mencatat pesanan");
    expect(withoutOrders.prompt).toContain("dan mengelola tenggat tugas agar tidak ada yang terlewat");
    expect(withoutOrders.prompt).not.toContain("Jika pesan memuat pesanan pelanggan");
    expect(withoutOrders.prompt).toContain("Catat to-do operasional konkret dari pesan pengguna menggunakan tool_create_todo_and_order tanpa parameter pesanan");
  });
});

describe("prompt renderer", () => {
  const compiled =
    "Atas\n" +
    "<!-- TRIGGER:CHAT_MASUK -->\nChat {{current_datetime}}\n<!-- /TRIGGER:CHAT_MASUK -->\n" +
    "<!-- TRIGGER:MORNING_BRIEF -->\nBrief\n<!-- /TRIGGER:MORNING_BRIEF -->";

  it("keeps only the selected trigger block", () => {
    const selected = selectTriggerBlock(compiled, "CHAT_MASUK");
    expect(selected).toContain("Chat {{current_datetime}}");
    expect(selected).not.toContain("Brief");
    expect(selected).not.toContain("TRIGGER:");
  });

  it("renders runtime values as text or JSON", () => {
    const context: RuntimeContext = {
      current_datetime: "2026-10-20T09:30:00+07:00",
      trigger_type: "CHAT_MASUK",
      active_todos: [{ id: "1" }],
      untimed_recent_todos: [],
      daily_stats: null,
      calendar_events_today: [],
      recent_messages: [],
    };
    const output = renderPrompt(compiled, "CHAT_MASUK", context);
    expect(output).toContain("Chat 2026-10-20T09:30:00+07:00");
    expect(output).toContain("Atas");
  });

  it("throws when a runtime placeholder is missing", () => {
    expect(() =>
      renderPrompt(
        "{{current_datetime}} {{missing_key}}",
        "CHAT_MASUK",
        { current_datetime: "x" } as RuntimeContext,
      ),
    ).toThrow("placeholder runtime tidak terisi");
  });
});
