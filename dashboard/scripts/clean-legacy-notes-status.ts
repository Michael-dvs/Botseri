#!/usr/bin/env tsx

/**
 * Skrip satu kali pembersihan penanda lama [STATUS: SELESAI] pada kolom notes (S04 §4.5).
 * Mendukung mode aman --dry-run (default) dan --apply.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function cleanNotes(notes: string): string {
  let cleaned = notes.replace(/\[STATUS:\s*SELESAI\]/gi, "");
  cleaned = cleaned.replace(/\s*\|\s*\|\s*/g, " | ");
  cleaned = cleaned.replace(/^\s*\|\s*/, "");
  cleaned = cleaned.replace(/\s*\|\s*$/, "");
  return cleaned.trim();
}

async function main() {
  const isApply = process.argv.includes("--apply");

  console.log(`[CLEAN-NOTES] Mode: ${isApply ? "--apply (perubahan disimpan)" : "--dry-run (simulasi)"}`);

  const orders = await prisma.order.findMany({
    where: {
      notes: {
        contains: "[STATUS: SELESAI]",
      },
    },
    select: {
      id: true,
      customer_name: true,
      notes: true,
    },
  });

  console.log(`[CLEAN-NOTES] Ditemukan ${orders.length} pesanan dengan penanda [STATUS: SELESAI].`);

  if (orders.length === 0) {
    console.log("[CLEAN-NOTES] Semua baris notes sudah bersih.");
    return;
  }

  let cleanedCount = 0;
  for (const o of orders) {
    const original = o.notes || "";
    const sanitized = cleanNotes(original);
    console.log(`- #ORD-${o.id.slice(0, 8).toUpperCase()} (${o.customer_name}):`);
    console.log(`    Asli   : "${original}"`);
    console.log(`    Bersih : "${sanitized}"`);

    if (isApply) {
      await prisma.order.update({
        where: { id: o.id },
        data: { notes: sanitized || null },
      });
      cleanedCount++;
    }
  }

  if (isApply) {
    console.log(`[CLEAN-NOTES] Sukses: ${cleanedCount} baris pesanan berhasil diperbarui.`);
  } else {
    console.log("[CLEAN-NOTES] Selesai simulasi. Gunakan --apply untuk menerapkan ke database.");
  }
}

main()
  .catch((err) => {
    console.error("[CLEAN-NOTES] Terjadi kesalahan:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
