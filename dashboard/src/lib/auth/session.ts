import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "./constants";

export { SESSION_COOKIE, SESSION_MAX_AGE };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET tidak ada");
  return new TextEncoder().encode(value);
}

export async function createSessionToken(
  adminId: string,
  username: string,
  tokenVersion = 0,
): Promise<string> {
  return new SignJWT({ username, token_version: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySessionToken(
  token: string,
): Promise<{ sub: string; username: string; token_version: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.username !== "string") return null;
    const tokenVersion = typeof payload.token_version === "number" ? payload.token_version : 0;
    return { sub: payload.sub, username: payload.username, token_version: tokenVersion };
  } catch {
    return null;
  }
}

export async function getSession(
  cookieToken?: string,
): Promise<{ sub: string; username: string; token_version: number } | null> {
  const token = cookieToken ?? cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const verified = await verifySessionToken(token);
  if (!verified) return null;

  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: verified.sub },
      select: { token_version: true },
    });
    if (!admin || verified.token_version < admin.token_version) {
      return null;
    }
  } catch {
    return null;
  }

  return verified;
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
