export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getGoogleRow,
  redirectUri,
  saveClientCredentials,
} from "@/lib/google/oauth";

const schema = z.object({
  client_id: z.string().trim().min(10).max(255),
  client_secret: z.string().trim().min(10).max(255),
});

export async function GET() {
  const row = await getGoogleRow();
  return NextResponse.json({
    ok: true,
    client_id: row?.client_id ?? null,
    has_secret: Boolean(row?.client_secret_enc),
    status: row?.status ?? "DISCONNECTED",
    account_email: row?.account_email ?? null,
    redirect_uri: redirectUri(),
  });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  await saveClientCredentials(parsed.data.client_id, parsed.data.client_secret);
  return NextResponse.json({ ok: true });
}
