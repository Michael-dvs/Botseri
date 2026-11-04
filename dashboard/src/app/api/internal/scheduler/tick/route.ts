import { NextResponse } from "next/server";
import { recordEvent } from "@/lib/events";
import { checkInternalAuth } from "@/lib/internal/auth";
import { tick } from "@/lib/scheduler/tick";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await tick(new Date());
    await recordEvent("INFO", "SCHEDULER", "TICK_OK", { jobs: result.jobs.length });
    return NextResponse.json(result);
  } catch (error) {
    await recordEvent("ERROR", "SCHEDULER", "TICK_FAILED", {
      error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
    });
    return NextResponse.json({ error: "Scheduler gagal memproses tick" }, { status: 500 });
  }
}
