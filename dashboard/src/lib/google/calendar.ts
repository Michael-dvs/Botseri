import type { calendar_v3 } from "googleapis";
import { prisma } from "@/lib/db";
import { localDayUtcBounds } from "@/lib/time";
import { getGoogleClients, googleErrorStatus } from "./client";

export type CalendarEventSummary = {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
};

export type CalendarTodo = {
  id: string;
  title: string;
  description: string | null;
  due_at: Date;
  status: string;
};

function eventId(todoId: string): string {
  return todoId.replace(/-/g, "");
}

function eventBody(todo: CalendarTodo, timeZone: string) {
  const start = todo.due_at;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: eventId(todo.id),
    summary: `${todo.status === "DONE" ? "[SELESAI] " : ""}${todo.title}`,
    description: todo.description ?? undefined,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    extendedProperties: { private: { botseri_todo_id: todo.id } },
  } satisfies calendar_v3.Schema$Event;
}

export async function upsertCalendarEvent(
  todo: CalendarTodo,
  calendarId: string,
  timeZone: string,
  hasExisting: boolean,
): Promise<string> {
  const { calendar } = await getGoogleClients();
  const requestBody = eventBody(todo, timeZone);

  if (!hasExisting) {
    try {
      const created = await calendar.events.insert({ calendarId, requestBody });
      return created.data.id ?? eventId(todo.id);
    } catch (error) {
      if (googleErrorStatus(error) !== 409) throw error;
    }
  }

  try {
    const updated = await calendar.events.patch({
      calendarId,
      eventId: eventId(todo.id),
      requestBody,
    });
    return updated.data.id ?? eventId(todo.id);
  } catch (error) {
    // Event bisa terhapus manual dari Google Calendar.
    if (googleErrorStatus(error) !== 404) throw error;
    const created = await calendar.events.insert({ calendarId, requestBody });
    return created.data.id ?? eventId(todo.id);
  }
}

export async function completeCalendarEvent(
  todo: CalendarTodo,
  calendarId: string,
  timeZone: string,
): Promise<void> {
  const { calendar } = await getGoogleClients();
  try {
    await calendar.events.patch({
      calendarId,
      eventId: eventId(todo.id),
      requestBody: {
        summary: `[SELESAI] ${todo.title}`,
        start: { dateTime: todo.due_at.toISOString(), timeZone },
        end: {
          dateTime: new Date(todo.due_at.getTime() + 3600_000).toISOString(),
          timeZone,
        },
      },
    });
  } catch (error) {
    if (googleErrorStatus(error) !== 404) throw error;
    await upsertCalendarEvent(todo, calendarId, timeZone, false);
  }
}

export async function deleteCalendarEvent(
  todoId: string,
  calendarId: string,
): Promise<void> {
  const { calendar } = await getGoogleClients();
  try {
    await calendar.events.delete({ calendarId, eventId: eventId(todoId) });
  } catch (error) {
    if (googleErrorStatus(error) !== 404) throw error;
  }
}

export async function listCalendarEventsToday(
  timezone: string,
): Promise<CalendarEventSummary[]> {
  const oauth = await prisma.oAuthToken.findFirst({ where: { provider: "google" } });
  if (!oauth || oauth.status !== "CONNECTED") return [];

  const { start, end } = localDayUtcBounds(new Date(), timezone);
  const { calendar } = await getGoogleClients();
  const response = await calendar.events.list(
    {
      calendarId: oauth.calendar_id ?? "primary",
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    },
    { signal: AbortSignal.timeout(20_000) },
  );

  return (response.data.items ?? []).map((event) => ({
    title: event.summary?.trim() || "(tanpa judul)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    all_day: Boolean(event.start?.date && !event.start.dateTime),
  }));
}
