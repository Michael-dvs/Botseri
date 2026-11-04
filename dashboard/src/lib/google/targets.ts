import type { Todo } from "@prisma/client";

export type GoogleSyncMode = "AUTO" | "BOTH";

type SyncTargetInput = Pick<Todo, "has_specific_time" | "due_at">;

// Calendar butuh jam; tanpa due_at tidak ada event yang bisa dibuat.
export function calendarTarget(
  todo: SyncTargetInput,
  mode: GoogleSyncMode,
): boolean {
  if (!todo.due_at) return false;
  return mode === "BOTH" || todo.has_specific_time;
}

export function taskTarget(
  todo: SyncTargetInput,
  mode: GoogleSyncMode,
): boolean {
  if (mode === "BOTH") return true;
  return !calendarTarget(todo, mode);
}
