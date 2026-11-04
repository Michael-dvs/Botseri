import { type AuthorizedNumber } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";

/**
 * Spesifikasi kanonik tunggal untuk mengambil Owner Utama Botseri (S10 §3).
 * 1. Mengambil nomor owner yang ditandai is_primary = true.
 * 2. Jika belum ada, auto-heal atomik: tetapkan owner dengan created_at tertua menjadi is_primary = true.
 */
export async function getPrimaryOwner(): Promise<AuthorizedNumber | null> {
  const explicit = await prisma.authorizedNumber.findFirst({
    where: { is_owner: true, is_primary: true },
  });
  if (explicit) return explicit;

  // Auto-heal: cari owner tertua dan tetapkan sebagai primary
  const oldest = await prisma.authorizedNumber.findFirst({
    where: { is_owner: true },
    orderBy: { created_at: "asc" },
  });

  if (oldest) {
    try {
      const updated = await prisma.authorizedNumber.update({
        where: { id: oldest.id },
        data: { is_primary: true },
      });
      void recordEvent("INFO", "OWNER_PRIMARY", "AUTO_HEAL_PRIMARY_OWNER", {
        owner_id: oldest.id,
        phone_e164: oldest.phone_e164,
      });
      return { ...oldest, ...updated, is_primary: true };
    } catch {
      // Jika terjadi race condition dengan proses lain, baca ulang
      return prisma.authorizedNumber.findFirst({
        where: { is_owner: true, is_primary: true },
      });
    }
  }

  return null;
}
