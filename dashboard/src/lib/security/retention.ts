import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePhoneE164, toChatId } from "@/lib/customer/phone";

export interface RetentionOptions {
  dryRun?: boolean;
  now?: Date;
}

export interface RetentionSummary {
  dryRun: boolean;
  retentionDays: number;
  messageLogEligible: number;
  customerSessionEligible: number;
  ordersEligibleForAnonymization: number;
  softDeleteEligibleForPurge: number;
}

export interface PurgeSummary {
  customerPhone: string;
  customerChatId: string;
  deletedSessions: number;
  deletedLogs: number;
  anonymizedOrders: number;
}

/**
 * Eksekutor kebijakan retensi data berkala (S12 §4).
 * Secara bawaan selalu berjalan dalam mode aman dry-run.
 */
export async function runRetention(options?: RetentionOptions): Promise<RetentionSummary> {
  const dryRun = options?.dryRun ?? true;
  const now = options?.now || new Date();

  const settings = await prisma.botSettings.findUnique({
    where: { id: 1 },
    select: { customer_data_retention_days: true },
  });
  const retentionDays = settings?.customer_data_retention_days || 365;

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600_000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600_000);
  const orderCutoff = new Date(now.getTime() - retentionDays * 24 * 3600_000);

  // 1. message_log (> 90 hari)
  const messageLogWhere = {
    created_at: { lt: ninetyDaysAgo },
  };

  // 2. customer_sessions (> 90 hari inaktif & tanpa pesanan aktif)
  const candidateSessions = await prisma.customerSession.findMany({
    where: {
      last_message_at: { lt: ninetyDaysAgo },
    },
    select: { id: true, phone_e164: true },
  });

  const activeOrders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS] },
      deleted_at: null,
    },
    select: { customer_chat_id: true, customer_contact: true },
  });

  const activeContacts = new Set<string>();
  for (const o of activeOrders) {
    if (o.customer_chat_id) activeContacts.add(o.customer_chat_id.replace(/\D/g, ""));
    if (o.customer_contact) activeContacts.add(o.customer_contact.replace(/\D/g, ""));
  }

  const eligibleSessionIds = candidateSessions
    .filter((s) => !activeContacts.has(s.phone_e164.replace(/\D/g, "")))
    .map((s) => s.id);

  // 3. orders (COMPLETED atau CANCELLED > retentionDays)
  const anonymizeOrderWhere = {
    status: { in: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
    created_at: { lt: orderCutoff },
    customer_name: { not: "Pelanggan Teranonimasi" },
  };

  // 4. Soft-delete orders (> 30 hari di kotak Sampah)
  const softDeletePurgeWhere = {
    deleted_at: { not: null, lt: thirtyDaysAgo },
  };

  if (dryRun) {
    const [messageLogEligible, ordersEligibleForAnonymization, softDeleteEligibleForPurge] =
      await Promise.all([
        prisma.messageLog.count({ where: messageLogWhere }),
        prisma.order.count({ where: anonymizeOrderWhere }),
        prisma.order.count({ where: softDeletePurgeWhere }),
      ]);

    return {
      dryRun: true,
      retentionDays,
      messageLogEligible,
      customerSessionEligible: eligibleSessionIds.length,
      ordersEligibleForAnonymization,
      softDeleteEligibleForPurge,
    };
  }

  // Eksekusi Apply di dalam transaksi
  const summary = await prisma.$transaction(async (tx) => {
    const msgRes = await tx.messageLog.deleteMany({ where: messageLogWhere });
    const sessRes = eligibleSessionIds.length > 0
      ? await tx.customerSession.deleteMany({ where: { id: { in: eligibleSessionIds } } })
      : { count: 0 };
    const anonRes = await tx.order.updateMany({
      where: anonymizeOrderWhere,
      data: {
        customer_name: "Pelanggan Teranonimasi",
        customer_contact: "080000000000",
        customer_chat_id: null,
        delivery_address: "Alamat Dihapus",
        notes: null,
      },
    });
    const purgeRes = await tx.order.deleteMany({ where: softDeletePurgeWhere });

    return {
      dryRun: false,
      retentionDays,
      messageLogEligible: msgRes.count,
      customerSessionEligible: sessRes.count,
      ordersEligibleForAnonymization: anonRes.count,
      softDeleteEligibleForPurge: purgeRes.count,
    };
  });

  return summary;
}

/**
 * Pembersihan data pelanggan atas permintaan (Right to be Forgotten) (S12 §5).
 */
export async function purgeCustomerData(
  phoneOrChatId: string,
  _options?: { now?: Date },
): Promise<PurgeSummary> {
  void _options;
  const digits = phoneOrChatId.replace(/\D/g, "");
  const targetPhone = normalizePhoneE164(phoneOrChatId) || (digits ? `+${digits}` : phoneOrChatId);
  const targetChatId = toChatId(targetPhone) || (phoneOrChatId.includes("@") ? phoneOrChatId : `${digits}@c.us`);

  return prisma.$transaction(async (tx) => {
    const sessRes = await tx.customerSession.deleteMany({
      where: {
        OR: [
          { phone_e164: targetPhone },
          { phone_e164: digits },
        ],
      },
    });

    const msgRes = await tx.messageLog.deleteMany({
      where: {
        chat_id: targetChatId,
      },
    });

    const anonRes = await tx.order.updateMany({
      where: {
        OR: [
          { customer_chat_id: targetChatId },
          { customer_contact: { in: [targetPhone, digits] } },
        ],
      },
      data: {
        customer_name: "Pelanggan Teranonimasi",
        customer_contact: "080000000000",
        customer_chat_id: null,
        delivery_address: "Alamat Dihapus",
        notes: null,
      },
    });

    return {
      customerPhone: targetPhone,
      customerChatId: targetChatId,
      deletedSessions: sessRes.count,
      deletedLogs: msgRes.count,
      anonymizedOrders: anonRes.count,
    };
  });
}
