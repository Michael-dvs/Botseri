import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";

type EventLevel = "INFO" | "WARN" | "ERROR";

export async function recordEvent(
  level: EventLevel,
  source: string,
  event: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.systemEvent.create({
      data: {
        level,
        source,
        code: event,
        message: event,
        context: context === undefined ? undefined : (context as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    log("ERROR", "events", "failed to record event", { event }, error);
  }
}
