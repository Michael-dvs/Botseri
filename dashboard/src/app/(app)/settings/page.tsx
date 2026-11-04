import { prisma } from "@/lib/db";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, holidays] = await Promise.all([
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
  ]);

  return (
    <SettingsForm
      initial={{
        brand_name: settings.brand_name,
        business_type: settings.business_type,
        owner_name: settings.owner_name,
        timezone: settings.timezone,
        work_hours_start: settings.work_hours_start,
        work_hours_end: settings.work_hours_end,
        early_brief_time: settings.early_brief_time,
        working_days: settings.working_days,
        behavior_mode: settings.behavior_mode,
        behavior_instruction: settings.behavior_instruction,
        reminder_interval_minutes: settings.reminder_interval_minutes,
        reminder_max_per_day: settings.reminder_max_per_day,
        reminder_max_rank: settings.reminder_max_rank,
        brief_window_minutes: settings.brief_window_minutes,
        eod_window_minutes: settings.eod_window_minutes,
        default_due_time: settings.default_due_time,
        google_sync_mode: settings.google_sync_mode,
        enable_orders: settings.enable_orders,
        bot_enabled: settings.bot_enabled,
      }}
      initialHolidays={holidays.map((holiday) => ({
        date: holiday.date.toISOString().slice(0, 10),
        label: holiday.label,
      }))}
      promptVersion={settings.compiled_prompt_version}
    />
  );
}
