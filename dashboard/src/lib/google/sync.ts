import type { OAuthToken, Todo } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import {
  completeCalendarEvent,
  deleteCalendarEvent,
  upsertCalendarEvent,
} from "./calendar";
import {
  completeGoogleTask,
  deleteGoogleTask,
  upsertGoogleTask,
} from "./tasks";
import { calendarTarget, taskTarget, type GoogleSyncMode } from "./targets";

function toCalendarTodo(todo: Todo) {
  if (!todo.due_at) throw new Error("event Calendar membutuhkan due_at");
  return {
    id: todo.id,
    title: todo.title,
    description: todo.description,
    due_at: todo.due_at,
    status: todo.status,
  };
}

export async function syncTodo(todoId: string): Promise<void> {
  const todo = await prisma.todo.findUnique({ where: { id: todoId } });
  if (!todo) return;

  const [settings, oauth] = await Promise.all([
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.oAuthToken.findFirst({ where: { provider: "google" } }),
  ]);

  if (oauth?.status === "NEEDS_REAUTH") {
    await prisma.todo.update({
      where: { id: todo.id },
      data: {
        google_sync_status: "PENDING",
        google_sync_error: "Google memerlukan otorisasi ulang",
      },
    });
    return;
  }
  if (!oauth || oauth.status !== "CONNECTED") {
    if (todo.google_sync_status !== "NOT_REQUIRED") {
      await prisma.todo.update({
        where: { id: todo.id },
        data: {
          google_sync_status: "NOT_REQUIRED",
          google_sync_attempts: 0,
          google_sync_error: null,
        },
      });
    }
    return;
  }

  const calendarId = oauth.calendar_id ?? "primary";
  const tasklistId = oauth.tasklist_id ?? "@default";
  const mode = settings.google_sync_mode as GoogleSyncMode;

  try {
    if (todo.status === "CANCELLED") {
      await deleteCalendarEvent(todo.id, calendarId);
      await deleteGoogleTask(todo.id, tasklistId, todo.google_task_id);
      await prisma.todo.update({
        where: { id: todo.id },
        data: {
          google_sync_status: "NOT_REQUIRED",
          google_sync_attempts: 0,
          calendar_event_id: null,
          google_task_id: null,
          google_sync_error: null,
        },
      });
      return;
    }

    const wantsCalendar = calendarTarget(todo, mode);
    const wantsTasks = taskTarget(todo, mode);
    let calendarEventId = todo.calendar_event_id;
    let googleTaskId = todo.google_task_id;

    if (!wantsCalendar && todo.calendar_event_id) {
      await deleteCalendarEvent(todo.id, calendarId);
      calendarEventId = null;
    }
    if (!wantsTasks && todo.google_task_id) {
      await deleteGoogleTask(todo.id, tasklistId, todo.google_task_id);
      googleTaskId = null;
    }

    if (wantsCalendar) {
      const calendarTodo = toCalendarTodo(todo);
      if (todo.status === "DONE" && todo.calendar_event_id) {
        await completeCalendarEvent(calendarTodo, calendarId, settings.timezone);
        calendarEventId = todo.calendar_event_id;
      } else {
        calendarEventId = await upsertCalendarEvent(
          calendarTodo,
          calendarId,
          settings.timezone,
          Boolean(todo.calendar_event_id),
        );
      }
    }

    if (wantsTasks) {
      if (todo.status === "DONE" && todo.google_task_id) {
        await completeGoogleTask(todo, tasklistId);
        googleTaskId = todo.google_task_id;
      } else {
        googleTaskId = await upsertGoogleTask(todo, tasklistId);
      }
    }

    await prisma.todo.update({
      where: { id: todo.id },
      data: {
        calendar_event_id: calendarEventId,
        google_task_id: googleTaskId,
        google_sync_status: "SYNCED",
        google_sync_attempts: 0,
        google_sync_error: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await prisma.todo.update({
      where: { id: todo.id },
      data: {
        google_sync_status: "FAILED",
        google_sync_attempts: { increment: 1 },
        google_sync_error: message.slice(0, 2000),
      },
    });
    await recordEvent("ERROR", "GOOGLE_SYNC", "GOOGLE_SYNC_FAILED", {
      todo_id: todo.id,
      error: message,
    });
  }
}

export function googleSyncDelayMinutes(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new RangeError("attempts harus berupa bilangan bulat nonnegatif");
  }
  return Math.min(2 ** attempts, 60);
}

export function googleSyncRetryDue(
  now: Date,
  lastAttemptAt: Date | null,
  attempts: number,
): boolean {
  if (!lastAttemptAt) return true;
  return now.getTime() - lastAttemptAt.getTime() >= googleSyncDelayMinutes(attempts) * 60_000;
}

export async function retryPendingGoogleSync(limit = 20): Promise<void> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit harus berupa bilangan bulat positif");
  }
  const candidates = await prisma.todo.findMany({
    where: {
      google_sync_status: { in: ["PENDING", "FAILED"] },
      google_sync_attempts: { lt: 8 },
    },
    orderBy: { updated_at: "asc" },
    take: limit * 2,
  });
  const now = new Date();
  let processed = 0;
  for (const todo of candidates) {
    if (processed >= limit) break;
    if (!googleSyncRetryDue(now, todo.updated_at, todo.google_sync_attempts)) continue;
    processed += 1;
    try {
      await syncTodo(todo.id);
    } catch (error) {
      await recordEvent("ERROR", "GOOGLE_SYNC", "GOOGLE_SYNC_RETRY_FAILED", {
        todo_id: todo.id,
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      });
    }
  }
}

export async function removeGoogleObjects(
  todo: Todo,
  oauth: OAuthToken | null,
): Promise<void> {
  if (!oauth || oauth.status !== "CONNECTED") return;
  const calendarId = oauth.calendar_id ?? "primary";
  const tasklistId = oauth.tasklist_id ?? "@default";
  try {
    await deleteCalendarEvent(todo.id, calendarId);
    await deleteGoogleTask(todo.id, tasklistId, todo.google_task_id);
  } catch (error) {
    await recordEvent("WARN", "GOOGLE_SYNC", "GOOGLE_DELETE_FAILED", {
      todo_id: todo.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
