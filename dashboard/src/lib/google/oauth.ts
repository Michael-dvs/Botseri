import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
];

export function redirectUri(): string {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) throw new Error("PUBLIC_BASE_URL belum diatur");
  return `${base.replace(/\/+$/, "")}/api/oauth/google/callback`;
}

export async function saveClientCredentials(
  clientId: string,
  clientSecret: string,
) {
  const existing = await prisma.oAuthToken.findFirst({
    where: { provider: "google" },
  });
  // client_id baru berarti token lama milik aplikasi OAuth lain: buang.
  const credentialsChanged = Boolean(
    existing?.client_id && existing.client_id !== clientId,
  );
  const data = {
    client_id: clientId,
    client_secret_enc: encryptSecret(
      clientSecret,
      "oauth_tokens.client_secret_enc",
    ),
    scopes: GOOGLE_SCOPES,
    ...(credentialsChanged
      ? {
          status: "DISCONNECTED" as const,
          access_token_enc: null,
          refresh_token_enc: null,
          expires_at: null,
          account_email: null,
        }
      : {}),
  };
  if (existing) {
    return prisma.oAuthToken.update({ where: { id: existing.id }, data });
  }
  return prisma.oAuthToken.create({
    data: { provider: "google", status: "DISCONNECTED", ...data },
  });
}

export async function getGoogleRow() {
  return prisma.oAuthToken.findFirst({ where: { provider: "google" } });
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};

export async function exchangeCode(code: string) {
  const row = await getGoogleRow();
  if (!row?.client_id || !row.client_secret_enc) {
    throw new Error("kredensial OAuth Google belum disimpan");
  }
  const clientSecret = decryptSecret(
    row.client_secret_enc,
    "oauth_tokens.client_secret_enc",
  );

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: row.client_id,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const tokens = (await tokenResponse.json().catch(() => ({}))) as TokenResponse;
  if (!tokenResponse.ok) {
    throw new Error(
      `penukaran kode gagal: ${tokens.error ?? tokenResponse.status}`,
    );
  }

  let email: string | null = null;
  if (tokens.access_token) {
    const profile = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (profile.ok) {
      const data = (await profile.json().catch(() => null)) as
        | { email?: unknown }
        | null;
      email = typeof data?.email === "string" ? data.email : null;
    }
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await prisma.oAuthToken.update({
    where: { id: row.id },
    data: {
      account_email: email,
      access_token_enc: tokens.access_token
        ? encryptSecret(tokens.access_token, "oauth_tokens.access_token_enc")
        : row.access_token_enc,
      refresh_token_enc: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token, "oauth_tokens.refresh_token_enc")
        : row.refresh_token_enc,
      expires_at: expiresAt,
      status: "CONNECTED",
    },
  });
}

export async function getValidAccessToken(): Promise<string> {
  const row = await getGoogleRow();
  if (!row || row.status !== "CONNECTED") {
    throw new Error("Google belum terhubung");
  }
  if (!row.access_token_enc) {
    throw new Error("access token tidak tersedia");
  }
  if (row.expires_at && row.expires_at.getTime() > Date.now() + 60_000) {
    return decryptSecret(row.access_token_enc, "oauth_tokens.access_token_enc");
  }

  if (!row.refresh_token_enc || !row.client_id || !row.client_secret_enc) {
    await prisma.oAuthToken.update({
      where: { id: row.id },
      data: { status: "NEEDS_REAUTH" },
    });
    throw new Error("refresh token tidak tersedia; hubungkan ulang Google");
  }

  const clientSecret = decryptSecret(
    row.client_secret_enc,
    "oauth_tokens.client_secret_enc",
  );
  const refreshToken = decryptSecret(
    row.refresh_token_enc,
    "oauth_tokens.refresh_token_enc",
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: row.client_id,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok) {
    if (data.error === "invalid_grant" || response.status === 400) {
      await prisma.oAuthToken.update({
        where: { id: row.id },
        data: { status: "NEEDS_REAUTH" },
      });
    }
    throw new Error(`refresh gagal: ${data.error ?? response.status}`);
  }

  const accessToken = data.access_token;
  if (!accessToken) throw new Error("refresh tidak mengembalikan access token");

  await prisma.oAuthToken.update({
    where: { id: row.id },
    data: {
      access_token_enc: encryptSecret(
        accessToken,
        "oauth_tokens.access_token_enc",
      ),
      expires_at: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
    },
  });
  return accessToken;
}
