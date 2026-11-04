import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth/constants";

const PUBLIC_PATHS: Record<string, true> = {
  "/login": true,
  "/setup": true,
  "/api/auth/login": true,
  "/api/setup": true,
};
const CSRF_EXEMPT_PATHS: Record<string, true> = {
  "/api/auth/login": true,
  "/api/setup": true,
};
const SAFE_METHODS: Record<string, true> = {
  GET: true,
  HEAD: true,
  OPTIONS: true,
};

function allowedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>([
    new URL(request.url).origin,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  const publicBase = process.env.PUBLIC_BASE_URL;
  if (publicBase) {
    try {
      origins.add(new URL(publicBase).origin);
    } catch {
      // Invalid PUBLIC_BASE_URL is ignored here; env validation reports it.
    }
  }
  return origins;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/internal/")) {
    if (
      request.headers.has("cf-connecting-ip") ||
      request.headers.has("cf-ray")
    ) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/oauth/google/callback")) {
    return NextResponse.next();
  }

  if (SAFE_METHODS[request.method] !== true && pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    if (origin) {
      if (!allowedOrigins(request).has(origin)) {
        return NextResponse.json(
          { error: "Origin tidak diizinkan" },
          { status: 403 },
        );
      }
    } else if (CSRF_EXEMPT_PATHS[pathname] !== true) {
      return NextResponse.json({ error: "Origin wajib ada" }, { status: 403 });
    }
  }

  if (PUBLIC_PATHS[pathname] === true) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const secret = process.env.SESSION_SECRET;
      if (secret) {
        await jwtVerify(token, new TextEncoder().encode(secret), {
          algorithms: ["HS256"],
        });
        return NextResponse.next();
      }
    } catch {
      // Expired or invalid sessions fall through to the login redirect.
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/).*)",
  ],
};
