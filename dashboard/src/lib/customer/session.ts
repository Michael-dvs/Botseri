import { prisma } from "@/lib/db";
import { normalizePhone } from "./phone";

export interface OrderSessionIdentifier {
  customer_chat_id?: string | null;
  customer_contact?: string | null;
}

/**
 * Helper terpadu pembuka kunci sesi pelanggan pasca-penyelesaian pesanan (S05 §3.3).
 * Mengutamakan kolom customer_chat_id yang terikat langsung ke sesi WhatsApp,
 * dengan fallback ke customer_contact untuk kompatibilitas data lama.
 */
export async function unmuteCustomerSessionByOrder(
  order: OrderSessionIdentifier
): Promise<number> {
  const targetPhones: string[] = [];

  if (order.customer_chat_id) {
    const raw = order.customer_chat_id.replace(/@(c\.us|s\.whatsapp\.net)$/i, "").trim();
    if (raw) {
      targetPhones.push(raw, `+${raw}`);
    }
  }

  if (order.customer_contact) {
    const raw = order.customer_contact.trim();
    const digits = normalizePhone(raw);
    if (digits) {
      targetPhones.push(digits, `+${digits}`);
    } else {
      targetPhones.push(raw);
    }
  }

  if (targetPhones.length === 0) return 0;

  const uniquePhones = Array.from(new Set(targetPhones));

  const sessions = await prisma.customerSession.findMany({
    where: {
      phone_e164: { in: uniquePhones },
    },
  });

  let count = 0;
  for (const session of sessions) {
    const meta = (session.metadata as Record<string, unknown>) || {};
    const updatedMeta = {
      ...meta,
      draft: null,
      retry_count: 0,
      waiting_since: null,
      unread_count: 0,
      ttl_warning_sent_at: null,
    };

    await prisma.customerSession.update({
      where: { id: session.id },
      data: {
        state: "ACTIVE",
        paused_at: null,
        metadata: updatedMeta,
      },
    });
    count++;
  }

  return count;
}
