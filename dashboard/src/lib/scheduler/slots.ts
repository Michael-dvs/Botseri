import type { BotSettings } from "@prisma/client";
import { minutesOfDay } from "@/lib/time";

export type ReminderSlot = { index: number; startMinutes: number };

type SlotSettings = Pick<
  BotSettings,
  "behavior_mode" | "reminder_interval_minutes" | "work_hours_start" | "work_hours_end"
>;

export function reminderSlots(settings: SlotSettings): ReminderSlot[] {
  const start = minutesOfDay(settings.work_hours_start);
  const end = minutesOfDay(settings.work_hours_end);

  if (settings.behavior_mode === "SANTAI" || settings.reminder_interval_minutes <= 0) {
    return [{ index: 1, startMinutes: Math.floor((start + end) / 2) }];
  }
  if (end <= start || end - start < 30) return [];

  const slots: ReminderSlot[] = [];
  for (let index = 1; index <= 24; index += 1) {
    const startMinutes = start + index * settings.reminder_interval_minutes;
    if (startMinutes > end - 30) break;
    slots.push({ index, startMinutes });
  }
  return slots;
}

export function activeReminderSlot(
  nowMinutes: number,
  settings: SlotSettings,
): ReminderSlot | null {
  const active = reminderSlots(settings).filter(
    (slot) => nowMinutes >= slot.startMinutes && nowMinutes < slot.startMinutes + 30,
  );
  return active.at(-1) ?? null;
}
