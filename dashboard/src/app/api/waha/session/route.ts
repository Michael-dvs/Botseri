export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logoutSession,
  restartSession,
  startSession,
  stopSession,
} from "@/lib/waha/client";

const schema = z.object({
  action: z.enum(["start", "stop", "restart", "logout"]),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "payload tidak valid" },
      { status: 400 },
    );
  }

  try {
    let upstream: Response;
    switch (parsed.data.action) {
      case "start":
        upstream = await startSession();
        break;
      case "stop":
        upstream = await stopSession();
        break;
      case "restart":
        upstream = await restartSession();
        break;
      case "logout":
        upstream = await logoutSession();
        break;
    }

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(
      { ok: upstream.ok, upstream: body },
      { status: upstream.ok ? 200 : upstream.status },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "WAHA tidak dapat dihubungi" },
      { status: 502 },
    );
  }
}
