import { prisma } from "@/lib/db";
import { localDateString } from "@/lib/time";
import { TodoBoard } from "./TodoBoard";

export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const [todos, levels, settings] = await Promise.all([
    prisma.todo.findMany({
      orderBy: [
        { priority_rank: "asc" },
        { due_at: { sort: "asc", nulls: "last" } },
        { created_at: "asc" },
      ],
      take: 200,
    }),
    prisma.priorityLevel.findMany({ orderBy: { rank: "asc" } }),
    prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);

  return (
    <TodoBoard
      initialTodos={todos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        status: todo.status,
        priority_rank: todo.priority_rank,
        due_at: todo.due_at?.toISOString() ?? null,
        planned_date: todo.planned_date.toISOString().slice(0, 10),
        category: todo.category,
        google_sync_status: todo.google_sync_status,
        completed_at: todo.completed_at?.toISOString() ?? null,
      }))}
      levels={levels.map((level) => ({
        rank: level.rank,
        label: level.label,
        color: level.color,
      }))}
      timezone={settings.timezone}
      today={localDateString(new Date(), settings.timezone)}
    />
  );
}
