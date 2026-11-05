#!/usr/bin/env tsx
/**
 * Skrip retensi dan pembersihan data pelanggan berkala (S12 §4).
 * Secara bawaan selalu berjalan dalam mode aman --dry-run (simulasi).
 *
 * Penggunaan:
 *   npx tsx scripts/retention.ts [--dry-run] [--apply]
 */

import { runRetention } from "../src/lib/security/retention";

async function main() {
  const isApply = process.argv.includes("--apply");
  console.log(`[RETENTION] Mode: ${isApply ? "APPLY (eksekusi nyata)" : "DRY-RUN (simulasi aman)"}`);

  const summary = await runRetention({ dryRun: !isApply });

  console.log("");
  console.log("=== Laporan Retensi Data Privasi ===");
  console.log(`Masa Retensi Pesanan  : ${summary.retentionDays} hari`);
  console.log(`Log Pesanan > 90 hari : ${summary.messageLogEligible} baris`);
  console.log(`Sesi Inaktif > 90 hari: ${summary.customerSessionEligible} baris`);
  console.log(`Pesanan Di-anonimkan  : ${summary.ordersEligibleForAnonymization} baris`);
  console.log(`Soft-delete > 30 hari : ${summary.softDeleteEligibleForPurge} baris`);
  console.log("====================================");

  if (!isApply) {
    console.log("[RETENTION] Selesai simulasi. Tidak ada data yang diubah atau dihapus.");
    console.log("[RETENTION] Untuk menerapkan, jalankan: ./scripts/backup.sh && npx tsx scripts/retention.ts --apply");
  } else {
    console.log("[RETENTION] Eksekusi pembersihan selesai.");
  }
}

main().catch((err) => {
  console.error("[RETENTION] Terjadi kesalahan:", err);
  process.exit(1);
});
