#!/usr/bin/env tsx
/**
 * Skrip penghapusan data pelanggan atas permintaan (Right to be Forgotten) (S12 §5).
 *
 * Penggunaan:
 *   npx tsx scripts/purge-customer.ts <nomor_telepon_atau_chat_id>
 */

import { purgeCustomerData } from "../src/lib/security/retention";

async function main() {
  const target = process.argv[2]?.trim();

  if (!target) {
    console.error("Gunakan: npx tsx scripts/purge-customer.ts <nomor_telepon_atau_chat_id>");
    process.exit(1);
  }

  console.log(`[PURGE] Menghapus data pelanggan untuk target: ${target}`);

  const summary = await purgeCustomerData(target);

  console.log("");
  console.log("=== Hasil Penghapusan Data Pelanggan ===");
  console.log(`Nomor Telepon    : ${summary.customerPhone}`);
  console.log(`WhatsApp Chat ID : ${summary.customerChatId}`);
  console.log(`Sesi Dihapus     : ${summary.deletedSessions} baris`);
  console.log(`Log Pesan Dihapus: ${summary.deletedLogs} baris`);
  console.log(`Pesanan Di-anonim: ${summary.anonymizedOrders} baris`);
  console.log("========================================");
  console.log("[PURGE] Selesai membersihkan data pribadi pelanggan.");
}

main().catch((err) => {
  console.error("[PURGE] Terjadi kesalahan:", err);
  process.exit(1);
});
