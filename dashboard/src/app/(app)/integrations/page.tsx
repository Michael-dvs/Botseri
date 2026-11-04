import { prisma } from "@/lib/db";
import { getSessionStatus } from "@/lib/waha/client";
import { redirectUri } from "@/lib/google/oauth";
import { IntegrationsPanel } from "./IntegrationsPanel";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [llmConfigs, google, waha, authorizedNumbers, settings] = await Promise.all([
    prisma.llmConfig.findMany({
      orderBy: [{ is_active: "desc" }, { updated_at: "desc" }],
    }),
    prisma.oAuthToken.findFirst({ where: { provider: "google" } }),
    getSessionStatus(),
    prisma.authorizedNumber.findMany({
      orderBy: [{ is_primary: "desc" }, { created_at: "desc" }],
    }),
    prisma.botSettings.findUnique({ where: { id: 1 }, select: { timezone: true } }),
  ]);
  return (
    <IntegrationsPanel
      initialConfigs={llmConfigs.map((config) => ({
        id: config.id,
        provider: config.provider,
        model: config.model,
        base_url: config.base_url,
        stt_model: config.stt_model,
        is_active: config.is_active,
        is_fallback: Boolean(config.is_fallback),
        temperature: config.temperature,
        max_output_tokens: config.max_output_tokens,
        price_input_per_mtok:
          config.price_input_per_mtok === null
            ? null
            : Number(config.price_input_per_mtok),
        price_output_per_mtok:
          config.price_output_per_mtok === null
            ? null
            : Number(config.price_output_per_mtok),
      }))}
      google={{
        client_id: google?.client_id ?? "",
        status: google?.status ?? "DISCONNECTED",
        account_email: google?.account_email ?? null,
      }}
      initialWahaStatus={waha.status}
      oauthRedirectUri={redirectUri()}
      initialAuthorizedNumbers={authorizedNumbers.map((n) => ({
        id: n.id,
        phone_e164: n.phone_e164,
        chat_id: n.chat_id,
        label: n.label,
        is_owner: n.is_owner,
        is_primary: n.is_primary,
        created_at: n.created_at.toISOString(),
        updated_at: n.updated_at.toISOString(),
      }))}
      timezone={settings?.timezone ?? "Asia/Jakarta"}
    />
  );
}
