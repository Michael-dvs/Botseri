import { prisma } from "@/lib/db";
import { StackEditor } from "./StackEditor";

export const dynamic = "force-dynamic";

export default async function PriorityStackPage() {
  const levels = await prisma.priorityLevel.findMany({
    orderBy: { rank: "asc" },
  });

  return (
    <StackEditor
      initial={levels.map((level) => ({
        id: level.id,
        rank: level.rank,
        label: level.label,
        description: level.description ?? "",
        rule_text: level.rule_text,
        color: level.color ?? "#9a3412",
      }))}
    />
  );
}
