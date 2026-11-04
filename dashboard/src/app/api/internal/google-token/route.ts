export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authorizeInternal } from "@/lib/internal/auth";
import { getValidAccessToken } from "@/lib/google/oauth";

export async function GET(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = await getValidAccessToken();
    return NextResponse.json({ ok: true, access_token: accessToken });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NEEDS_REAUTH",
          message:
            error instanceof Error ? error.message : "Google tidak tersedia",
        },
      },
      { status: 409 },
    );
  }
}
