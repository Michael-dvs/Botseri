import type { tasks_v1 } from "googleapis";
import { getGoogleClients, googleErrorStatus } from "./client";

const MARKER = "botseri:";

export type TaskTodo = {
  id: string;
  title: string;
  description: string | null;
  due_at: Date | null;
  planned_date: Date;
  status: string;
  google_task_id: string | null;
};

function dueIso(todo: TaskTodo): string | undefined {
  const date = todo.due_at ?? todo.planned_date;
  return date.toISOString();
}

function notes(todo: TaskTodo): string {
  return `${MARKER}${todo.id}\n${todo.description ?? ""}`.trim();
}

async function findTaskByMarker(
  tasklist: string,
  todoId: string,
): Promise<tasks_v1.Schema$Task | null> {
  const { tasks } = await getGoogleClients();
  // shortcut: hanya 100 task pertama yang dipindai, cukup untuk volume UMKM.
  const list = await tasks.tasks.list({
    tasklist,
    showCompleted: true,
    showHidden: true,
    maxResults: 100,
  });
  return (
    list.data.items?.find((item) =>
      item.notes?.includes(`${MARKER}${todoId}`),
    ) ?? null
  );
}

export async function upsertGoogleTask(
  todo: TaskTodo,
  tasklist: string,
): Promise<string> {
  const { tasks } = await getGoogleClients();
  const existing = todo.google_task_id
    ? { id: todo.google_task_id }
    : await findTaskByMarker(tasklist, todo.id);

  const body: tasks_v1.Schema$Task = {
    title: todo.title,
    notes: notes(todo),
    due: dueIso(todo),
    status: todo.status === "DONE" ? "completed" : "needsAction",
  };

  if (existing?.id) {
    try {
      const updated = await tasks.tasks.patch({
        tasklist,
        task: existing.id,
        requestBody: body,
      });
      return updated.data.id ?? existing.id;
    } catch (error) {
      // Task bisa terhapus manual dari Google Tasks: buat ulang.
      if (googleErrorStatus(error) !== 404) throw error;
    }
  }

  const created = await tasks.tasks.insert({ tasklist, requestBody: body });
  if (!created.data.id) throw new Error("Google Tasks tidak mengembalikan id");
  return created.data.id;
}

export async function completeGoogleTask(
  todo: TaskTodo,
  tasklist: string,
): Promise<void> {
  if (!todo.google_task_id) return;
  const { tasks } = await getGoogleClients();
  try {
    await tasks.tasks.patch({
      tasklist,
      task: todo.google_task_id,
      requestBody: { status: "completed" },
    });
  } catch (error) {
    if (googleErrorStatus(error) !== 404) throw error;
  }
}

export async function deleteGoogleTask(
  todoId: string,
  tasklist: string,
  knownId: string | null,
): Promise<void> {
  const { tasks } = await getGoogleClients();
  const targetId = knownId ?? (await findTaskByMarker(tasklist, todoId))?.id;
  if (!targetId) return;
  try {
    await tasks.tasks.delete({ tasklist, task: targetId });
  } catch (error) {
    if (googleErrorStatus(error) !== 404) throw error;
  }
}
