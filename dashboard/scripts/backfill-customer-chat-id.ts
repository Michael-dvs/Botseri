#!/usr/bin/env tsx

/**
 * Skrip migrasi backfill untuk mengisi kolom orders.customer_chat_id (S05 §3.2).
 * Mencocokkan normalizePhone(customer_contact) dengan customer_sessions.phone_e164.
 * Mendukung mode aman --dry-run (default) dan --apply.
 */

import { PrismaClient } from "@prisma/client";
import { normalizePhone, toChatId } from "../src/lib/customer/phone";

const prisma = new PrismaClient();

async function main() {
  const isApply = process.argv.includes("--apply");

  console.log(`[BACKFILL] Mode: ${isApply ? "--apply (perubahan disimpan)" : "--dry-run (simulasi)"}`);

  const orders = await prisma.order.findMany({
    where: {
      customer_chat_id: null,
      customer_contact: { not: null },
    },
    select: {
      id: true,
      customer_name: true,
      customer_contact: true,
    },
  });

  console.log(`[BACKFILL] Ditemukan ${orders.length} pesanan dengan customer_chat_id bernilai NULL.`);

  if (orders.length === 0) {
    console.log("[BACKFILL] Tidak ada baris yang perlu di-backfill.");
    return;
  }

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const o of orders) {
    const rawContact = o.customer_contact;
    const normalizedDigits = normalizePhone(rawContact);

    if (!normalizedDigits) {
      console.log(`  - #ORD-${o.id.slice(0, 8).toUpperCase()} (${o.customer_name}): Kontak '${rawContact}' tidak dapat dinormalisasi -> Dibiarkan NULL.`);
      unmatchedCount++;
      continue;
    }

    const session = await prisma.customerSession.findFirst({
      where: {
        OR: [
          { phone_e164: `+${normalizedDigits}` },
          { phone_e164: normalizedDigits },
        ],
      },
    });

    if (session) {
      const derivedChatId = toChatId(normalizedDigits);
      console.log(`  + #ORD-${o.id.slice(0, 8).toUpperCase()} (${o.customer_name}): Cocok dengan sesi (${session.phone_e164}) -> customer_chat_id: ${derivedChatId}`);
      if (isApply) {
        await prisma.order.update({
          where: { id: o.id },
          data: { customer_chat_id: derivedChatId },
        });
      }
      matchedCount++;
    } else {
      console.log(`  - #ORD-${o.id.slice(0, 8).toUpperCase()} (${o.customer_name}): Nomor '${normalizedDigits}' tidak memiliki sesi di customer_sessions -> Dibiarkan NULL.`);
      unmatchedCount++;
    }
  }

  console.log(`[BACKFILL] Selesai. Hasil: ${matchedCount} cocok & diperbarui, ${unmatchedCount} dibiarkan NULL.`);
  if (!isApply && matchedCount > 0) {
    console.log("[BACKFILL] Jalankan kembali dengan flag --apply untuk menyimpan perubahan ke database.");
  }
}

main()
  .catch((err) => {
    console.error("[BACKFILL] Terjadi kesalahan:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
