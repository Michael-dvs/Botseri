import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderPaymentStatus, OrderStatus } from "@prisma/client";
import {
  cancelOrder,
  completeOrder,
  hasActiveOrder,
  markPayment,
  releaseCustomerSession,
  setOrderStatus,
  softDeleteOrder,
} from "@/lib/orders/service";

const {
  prismaMock,
  recordEventMock,
} = vi.hoisted(() => ({
  prismaMock: {
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    customerSession: {
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    systemEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock)),
  },
  recordEventMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

describe("S10: Order Domain Service & Mute Policy", () => {
  const sampleOrder = {
    id: "ord-uuid-1",
    customer_name: "Andi Wijaya",
    customer_contact: "+628123456789",
    customer_chat_id: "628123456789@c.us",
    description: "Buket Bunga Meja",
    status: OrderStatus.PENDING,
    payment_status: OrderPaymentStatus.UNPAID,
    event_date: new Date("2026-11-10T10:00:00Z"),
    delivery_date: null,
    delivery_address: "Jakarta Selatan",
    notes: null,
    deleted_at: null,
    completed_at: null,
    created_at: new Date("2026-11-04T08:00:00Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    recordEventMock.mockResolvedValue({});
    prismaMock.order.findUnique.mockResolvedValue({ ...sampleOrder });
    prismaMock.order.update.mockImplementation(async ({ where, data }: any) => ({
      ...sampleOrder,
      ...data,
      id: where.id,
    }));
  });

  describe("1. completeOrder", () => {
    it("menandai COMPLETED, mengisi completed_at, melunasi jika pay: true, dan memanggil releaseCustomerSession", async () => {
      // Sesi pelanggan tanpa pesanan aktif lain
      prismaMock.order.findFirst.mockResolvedValue(null); // Tidak ada active order tersisa
      prismaMock.customerSession.findMany.mockResolvedValue([
        {
          id: "sess-1",
          phone_e164: "+628123456789",
          state: "PAUSED_FOR_OWNER",
          metadata: {},
        },
      ]);
      prismaMock.customerSession.update.mockResolvedValue({});

      const updated = await completeOrder("ord-uuid-1", { pay: true, actor: "owner" });

      expect(updated.status).toBe(OrderStatus.COMPLETED);
      expect(updated.payment_status).toBe(OrderPaymentStatus.PAID);
      expect(updated.completed_at).toBeInstanceOf(Date);

      // Verifikasi sesi pelanggan dibuka kuncinya
      expect(prismaMock.customerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sess-1" },
          data: expect.objectContaining({
            state: "ACTIVE",
            paused_at: null,
          }),
        })
      );

      expect(recordEventMock).toHaveBeenCalledWith(
        "INFO",
        "ORDER_SERVICE",
        "ORDER_MUTATED",
        expect.objectContaining({
          action: "COMPLETE",
          order_id: "ord-uuid-1",
        })
      );
    });

    it("tidak membuka kunci sesi pelanggan jika pelanggan masih memiliki pesanan aktif lain", async () => {
      // Ada pesanan aktif lain untuk pelanggan ini
      prismaMock.order.findFirst.mockResolvedValue({ id: "ord-uuid-2", status: OrderStatus.IN_PROGRESS });

      const updated = await completeOrder("ord-uuid-1", { pay: false });
      expect(updated.status).toBe(OrderStatus.COMPLETED);

      // Sesi pelanggan TIDAK boleh diunmute
      expect(prismaMock.customerSession.update).not.toHaveBeenCalled();
    });
  });

  describe("2. cancelOrder & softDeleteOrder", () => {
    it("cancelOrder menandai CANCELLED, mengisi deleted_at, dan membuka kunci sesi jika tidak ada pesanan aktif lain", async () => {
      prismaMock.order.findFirst.mockResolvedValue(null);
      prismaMock.customerSession.findMany.mockResolvedValue([]);

      const updated = await cancelOrder("ord-uuid-1", "Dibatalkan pelanggan");
      expect(updated.status).toBe(OrderStatus.CANCELLED);
      expect(updated.deleted_at).toBeInstanceOf(Date);
      expect(recordEventMock).toHaveBeenCalledWith(
        "INFO",
        "ORDER_SERVICE",
        "ORDER_MUTATED",
        expect.objectContaining({
          action: "CANCEL",
          order_id: "ord-uuid-1",
        })
      );
    });

    it("softDeleteOrder menandai deleted_at dan CANCELLED tanpa memanggil DELETE fisik di Prisma", async () => {
      prismaMock.order.findFirst.mockResolvedValue(null);
      prismaMock.customerSession.findMany.mockResolvedValue([]);

      const updated = await softDeleteOrder("ord-uuid-1");
      expect(updated.deleted_at).toBeInstanceOf(Date);
      expect(updated.status).toBe(OrderStatus.CANCELLED);
      // Memastikan tidak ada DELETE fisik
      expect((prismaMock.order as any).delete).toBeUndefined();
      expect((prismaMock.order as any).deleteMany).toBeUndefined();
    });
  });

  describe("3. setOrderStatus & markPayment", () => {
    it("setOrderStatus ke IN_PROGRESS memperbarui status", async () => {
      const updated = await setOrderStatus("ord-uuid-1", OrderStatus.IN_PROGRESS);
      expect(updated.status).toBe(OrderStatus.IN_PROGRESS);
    });

    it("markPayment memperbarui payment_status ke DP_PAID", async () => {
      const updated = await markPayment("ord-uuid-1", OrderPaymentStatus.DP_PAID);
      expect(updated.payment_status).toBe(OrderPaymentStatus.DP_PAID);
      expect(recordEventMock).toHaveBeenCalledWith(
        "INFO",
        "ORDER_SERVICE",
        "ORDER_MUTATED",
        expect.objectContaining({
          action: "MARK_PAYMENT",
          order_id: "ord-uuid-1",
        })
      );
    });
  });

  describe("4. hasActiveOrder & releaseCustomerSession", () => {
    it("hasActiveOrder mengembalikan true jika ada pesanan aktif dan false jika tidak ada", async () => {
      prismaMock.order.findFirst.mockResolvedValueOnce({ id: "active-1" });
      const active = await hasActiveOrder("628123456789@c.us");
      expect(active).toBe(true);

      prismaMock.order.findFirst.mockResolvedValueOnce(null);
      const inactive = await hasActiveOrder("628123456789@c.us");
      expect(inactive).toBe(false);
    });

    it("releaseCustomerSession mengembalikan 0 jika chat_id kosong atau pelanggan masih memiliki pesanan aktif", async () => {
      expect(await releaseCustomerSession(null)).toBe(0);
      expect(await releaseCustomerSession("")).toBe(0);

      // Pelanggan masih punya order aktif lain
      prismaMock.order.findFirst.mockResolvedValueOnce({ id: "active-another" });
      const res = await releaseCustomerSession("628123456789@c.us");
      expect(res).toBe(0);
    });
  });
});
