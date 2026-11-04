#!/usr/bin/env tsx

/**
 * Skrip pembersihan permanen pesanan yang di-soft-delete (INV-15 / S04).
 * Menghapus fisik baris pesanan dengan deleted_at lebih tua dari 30 hari.
 * Wajib dijalankan secara berkala atau setelah ./scripts/backup.sh.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  console.log(`[PURGE] Mencari pesanan terhapus sebelum: ${thirtyDaysAgo.toISOString()}...`);

  const candidates = await prisma.order.findMany({
    where: {
      deleted_at: {
        not: null,
        lt: thirtyDaysAgo,
      },
    },
    select: {
      id: true,
      customer_name: true,
      deleted_at: true,
    },
  });

  console.log(`[PURGE] Ditemukan ${candidates.length} pesanan yang memenuhi kriteria penghapusan permanen.`);

  if (candidates.length === 0) {
    console.log("[PURGE] Tidak ada pesanan lama yang perlu dihapus permanen.");
    return;
  }

  for (const c of candidates) {
    console.log(`  - #ORD-${c.id.slice(0, 8).toUpperCase()} (${c.customer_name}) dihapus pada ${c.deleted_at?.toISOString()}`);
  }

  if (isDryRun) {
    console.log("[PURGE] Mode --dry-run aktif: tidak ada perubahan fisik yang dilakukan pada database.");
    return;
  }

  const result = await prisma.order.deleteMany({
    where: {
      deleted_at: {
        not: null,
        lt: thirtyDaysAgo,
      },
    },
  });

  console.log(`[PURGE] Sukses: ${result.count} pesanan telah dihapus permanen dari basis data.`);
}

main()
  .catch((err) => {
    console.error("[PURGE] Terjadi kesalahan:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
