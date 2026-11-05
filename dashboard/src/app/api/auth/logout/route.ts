import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, isSecureRequest, getSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (session?.sub) {
      await prisma.adminUser.update({
        where: { id: session.sub },
        data: { token_version: { increment: 1 } },
      });
    }
  } catch {
    // Abaikan kegagalan database saat logout agar pembersihan cookie tetap berjalan
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
