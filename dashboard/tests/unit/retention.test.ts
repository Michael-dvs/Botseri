import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRetention, purgeCustomerData } from "@/lib/security/retention";

const {
  prismaMock,
} = vi.hoisted(() => ({
  prismaMock: {
    messageLog: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    customerSession: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    botSettings: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

describe("S12: Skrip Retensi Berkala & Purge Customer", () => {
  const baseNow = new Date("2026-11-05T10:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.botSettings.findUnique.mockResolvedValue({
      customer_data_retention_days: 365,
    });
  });

  describe("1. runRetention (Mode Dry-Run)", () => {
    it("menghitung jumlah baris yang memenuhi syarat tanpa mengubah atau menghapus data", async () => {
      prismaMock.messageLog.count.mockResolvedValueOnce(45);
      prismaMock.customerSession.findMany.mockResolvedValueOnce([
        { id: "sess-old-1", phone_e164: "+628111" },
        { id: "sess-old-2", phone_e164: "+628222" },
      ]);
      prismaMock.order.findMany.mockResolvedValueOnce([]); // Tidak ada active order
      prismaMock.order.count.mockResolvedValueOnce(12); // 12 orders > 365 hari
      prismaMock.order.count.mockResolvedValueOnce(3);  // 3 soft-deleted > 30 hari

      const result = await runRetention({ dryRun: true, now: baseNow });

      expect(result.dryRun).toBe(true);
      expect(result.messageLogEligible).toBe(45);
      expect(result.customerSessionEligible).toBe(2);
      expect(result.ordersEligibleForAnonymization).toBe(12);
      expect(result.softDeleteEligibleForPurge).toBe(3);

      // Verifikasi TIDAK ADA penghapusan atau pembaruan yang dipanggil
      expect(prismaMock.messageLog.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.customerSession.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.order.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("2. runRetention (Mode Apply)", () => {
    it("mengarsip/anonimkan pesanan lama dan menghapus log pesan secara nyata", async () => {
      prismaMock.messageLog.deleteMany.mockResolvedValueOnce({ count: 50 });
      prismaMock.customerSession.findMany.mockResolvedValueOnce([
        { id: "sess-old-1", phone_e164: "+628111" },
      ]);
      prismaMock.order.findMany.mockResolvedValueOnce([]); // No active order
      prismaMock.customerSession.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.order.updateMany.mockResolvedValueOnce({ count: 8 });
      prismaMock.order.deleteMany.mockResolvedValueOnce({ count: 2 });

      const result = await runRetention({ dryRun: false, now: baseNow });

      expect(result.dryRun).toBe(false);
      expect(prismaMock.messageLog.deleteMany).toHaveBeenCalled();
      expect(prismaMock.customerSession.deleteMany).toHaveBeenCalled();
      // Verifikasi anonimisasi PII pesanan lama (status & total harga dipertahankan)
      expect(prismaMock.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customer_name: "Pelanggan Teranonimasi",
            customer_contact: "080000000000",
            customer_chat_id: null,
            delivery_address: "Alamat Dihapus",
            notes: null,
          }),
        })
      );
      // Verifikasi pembersihan soft-deleted > 30 hari
      expect(prismaMock.order.deleteMany).toHaveBeenCalled();
    });
  });

  describe("3. purgeCustomerData (Hapus Data atas Permintaan)", () => {
    it("menghapus sesi, log pesan, dan menganonimkan pesanan untuk nomor tertentu", async () => {
      prismaMock.customerSession.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.messageLog.deleteMany.mockResolvedValueOnce({ count: 15 });
      prismaMock.order.updateMany.mockResolvedValueOnce({ count: 3 });

      const summary = await purgeCustomerData("081234567890", { now: baseNow });

      expect(summary.customerPhone).toBe("+6281234567890");
      expect(summary.deletedSessions).toBe(1);
      expect(summary.deletedLogs).toBe(15);
      expect(summary.anonymizedOrders).toBe(3);

      expect(prismaMock.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customer_name: "Pelanggan Teranonimasi",
            customer_contact: "080000000000",
            customer_chat_id: null,
          }),
        })
      );
    });
  });
});
