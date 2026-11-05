import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  createSessionToken,
  isSecureRequest,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/auth/rate-limit";

const schema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Data login tidak valid" }, { status: 400 });
  }

  if (
    !rateLimit(
      `login:${clientIp(request)}:${parsed.data.username}`,
      5,
      5 * 60 * 1000,
    )
  ) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan" },
      { status: 429 },
    );
  }

  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  if (!settings?.setup_completed) {
    return NextResponse.json(
      { error: "Setup belum selesai" },
      { status: 409 },
    );
  }

  const admin = await prisma.adminUser.findUnique({
    where: { username: parsed.data.username },
  });
  if (!admin || !(await verifyPassword(admin.password_hash, parsed.data.password))) {
    return NextResponse.json(
      { error: "Username atau password salah" },
      { status: 401 },
    );
  }

  const token = await createSessionToken(admin.id, admin.username, admin.token_version);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(isSecureRequest(request)),
  );
  return response;
}
