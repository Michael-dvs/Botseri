export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionStatus, wahaSessionName } from "@/lib/waha/client";

export async function GET() {
  const status = await getSessionStatus();
  return NextResponse.json({
    ok: true,
    session: wahaSessionName(),
    status: status.status,
  });
}
