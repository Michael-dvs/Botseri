export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const expected = request.cookies.get("google_oauth_state")?.value;

  if (!state || !expected || state !== expected) {
    return NextResponse.redirect(
      new URL("/integrations?google=state_error", request.url),
    );
  }
  if (error || !code) {
    return NextResponse.redirect(
      new URL("/integrations?google=denied", request.url),
    );
  }

  try {
    await exchangeCode(code);
  } catch {
    return NextResponse.redirect(
      new URL("/integrations?google=error", request.url),
    );
  }

  const response = NextResponse.redirect(
    new URL("/integrations?google=connected", request.url),
  );
  response.cookies.set("google_oauth_state", "", { path: "/", maxAge: 0 });
  return response;
}
