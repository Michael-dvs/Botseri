import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/tools/update-order/route";
import { OrderPaymentStatus, OrderStatus } from "@prisma/client";

const {
  authMock,
  orderFindUniqueMock,
  orderDeleteMock,
  orderUpdateMock,
  orderFindManyMock,
  orderUpdateManyMock,
  queryRawMock,
  customerSessionUpdateManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  orderFindUniqueMock: vi.fn(),
  orderDeleteMock: vi.fn(),
  orderUpdateMock: vi.fn(),
  orderFindManyMock: vi.fn(),
  orderUpdateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    customerSession: {
      updateMany: (...args: unknown[]) => customerSessionUpdateManyMock(...args),
    },
    order: {
      findUnique: (...args: unknown[]) => orderFindUniqueMock(...args),
      delete: (...args: unknown[]) => orderDeleteMock(...args),
      update: (...args: unknown[]) => orderUpdateMock(...args),
      findMany: (...args: unknown[]) => orderFindManyMock(...args),
      updateMany: (...args: unknown[]) => orderUpdateManyMock(...args),
    },
  },
}));

function makeRequest(body: Record<string, unknown>, authorized = true) {
  authMock.mockReturnValue(authorized);
  return new Request("http://localhost:3000/api/internal/tools/update-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/tools/update-order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
  });

  it("returns 401 if unauthorized", async () => {
    const res = await POST(makeRequest({ order_id: "504D0BA0", action: "MARK_COMPLETED" }, false));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body schema", async () => {
    const res = await POST(makeRequest({ order_id: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when order is not found", async () => {
    queryRawMock.mockResolvedValue([]);
    const res = await POST(makeRequest({ order_id: "nonexistent", action: "MARK_COMPLETED" }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("tidak ditemukan");
  });

  it("updates order operational status to COMPLETED with MARK_COMPLETED without changing payment status", async () => {
    const fakeOrder = {
      id: "504d0ba0-1111-2222-3333-444455556666",
      customer_name: "Michael Aristyo",
      customer_contact: "+628111222333",
      notes: "Jam Pengiriman: 10:00 WIB",
      status: OrderStatus.PENDING,
      payment_status: OrderPaymentStatus.UNPAID,
    };

    queryRawMock.mockResolvedValue([{ id: fakeOrder.id }]);
    orderFindUniqueMock.mockResolvedValue(fakeOrder);
    orderUpdateMock.mockResolvedValue({
      ...fakeOrder,
      status: OrderStatus.COMPLETED,
      notes: fakeOrder.notes + " | [STATUS: SELESAI]",
    });

    const res = await POST(makeRequest({ order_id: "#ORD-504D0BA0", action: "MARK_COMPLETED" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe("MARK_COMPLETED");
    expect(data.message).toContain("Michael Aristyo");
    expect(data.message).toContain("#ORD-504D0BA0");
    expect(data.message).toContain("SELESAI dikerjakan/dikirim");
    expect(data.message).toContain("Belum dibayar");
    expect(data.message).toContain("Bot di-unmute");

    expect(orderUpdateMock).toHaveBeenCalledWith({
      where: { id: fakeOrder.id },
      data: {
        status: OrderStatus.COMPLETED,
        completed_at: expect.any(Date),
        notes: expect.stringContaining("[STATUS: SELESAI]"),
      },
    });

    expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: "ACTIVE", paused_at: null },
      })
    );
  });

  it("updates payment status to PAID with MARK_PAID without changing operational status", async () => {
    const fakeOrder = {
      id: "504d0ba0-1111-2222-3333-444455556666",
      customer_name: "Michael Aristyo",
      customer_contact: "+628111222333",
      status: OrderStatus.PENDING,
      payment_status: OrderPaymentStatus.UNPAID,
    };

    queryRawMock.mockResolvedValue([{ id: fakeOrder.id }]);
    orderFindUniqueMock.mockResolvedValue(fakeOrder);
    orderUpdateMock.mockResolvedValue({
      ...fakeOrder,
      payment_status: OrderPaymentStatus.PAID,
    });

    const res = await POST(makeRequest({ order_id: "504D0BA0", action: "MARK_PAID" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe("MARK_PAID");
    expect(data.message).toContain("LUNAS");
    expect(data.message).toContain("MENUNGGU pengerjaan/pengiriman");

    expect(orderUpdateMock).toHaveBeenCalledWith({
      where: { id: fakeOrder.id },
      data: {
        payment_status: OrderPaymentStatus.PAID,
      },
    });
  });

  it("updates both operational status and payment status with COMPLETE_AND_PAY", async () => {
    const fakeOrder = {
      id: "504d0ba0-1111-2222-3333-444455556666",
      customer_name: "Michael Aristyo",
      customer_contact: "+628111222333",
      status: OrderStatus.PENDING,
      payment_status: OrderPaymentStatus.UNPAID,
    };

    queryRawMock.mockResolvedValue([{ id: fakeOrder.id }]);
    orderFindUniqueMock.mockResolvedValue(fakeOrder);
    orderUpdateMock.mockResolvedValue({
      ...fakeOrder,
      status: OrderStatus.COMPLETED,
      payment_status: OrderPaymentStatus.PAID,
    });

    const res = await POST(makeRequest({ order_id: "#ORD-504D0BA0", action: "COMPLETE_AND_PAY" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe("COMPLETE_AND_PAY");
    expect(data.message).toContain("SELESAI dan LUNAS");
    expect(data.message).toContain("Bot di-unmute");

    expect(orderUpdateMock).toHaveBeenCalledWith({
      where: { id: fakeOrder.id },
      data: {
        status: OrderStatus.COMPLETED,
        completed_at: expect.any(Date),
        payment_status: OrderPaymentStatus.PAID,
        notes: expect.stringContaining("[STATUS: SELESAI]"),
      },
    });
  });

  it("cancels order when action is CANCEL", async () => {
    const fakeOrder = {
      id: "40e6713c-aaaa-bbbb-cccc-ddddeeeeffff",
      customer_name: "Rina S",
      customer_contact: "+628777777777",
      status: OrderStatus.PENDING,
    };

    queryRawMock.mockResolvedValue([{ id: fakeOrder.id }]);
    orderFindUniqueMock.mockResolvedValue(fakeOrder);
    orderUpdateMock.mockResolvedValue({
      ...fakeOrder,
      status: OrderStatus.CANCELLED,
    });

    const res = await POST(makeRequest({ order_id: "40E6713C", action: "CANCEL" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe("CANCEL");
    expect(data.message).toContain("DIBATALKAN");
    expect(orderUpdateMock).toHaveBeenCalledWith({
      where: { id: fakeOrder.id },
      data: { status: OrderStatus.CANCELLED },
    });
    expect(customerSessionUpdateManyMock).toHaveBeenCalled();
  });

  it("deletes order when action is DELETE", async () => {
    const fakeOrder = {
      id: "40e6713c-aaaa-bbbb-cccc-ddddeeeeffff",
      customer_name: "Rina S",
      customer_contact: "+628777777777",
      status: OrderStatus.PENDING,
    };

    queryRawMock.mockResolvedValue([{ id: fakeOrder.id }]);
    orderFindUniqueMock.mockResolvedValue(fakeOrder);
    orderDeleteMock.mockResolvedValue(fakeOrder);

    const res = await POST(makeRequest({ order_id: "40E6713C", action: "DELETE" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe("DELETE");
    expect(data.message).toContain("berhasil dihapus dari sistem");
    expect(orderDeleteMock).toHaveBeenCalledWith({ where: { id: fakeOrder.id } });
    expect(customerSessionUpdateManyMock).toHaveBeenCalled();
  });

  it("bulk updates all active orders to COMPLETED and un-mutes customers when order_id is ALL", async () => {
    orderFindManyMock.mockResolvedValue([
      { id: "ord-1", customer_contact: "+628123456789" },
      { id: "ord-2", customer_contact: "081987654321" },
    ]);
    orderUpdateManyMock.mockResolvedValue({ count: 2 });

    const res = await POST(makeRequest({ order_id: "ALL", action: "MARK_COMPLETED" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toContain("Sebanyak 2 pesanan aktif berhasil ditandai selesai");
    expect(orderUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["ord-1", "ord-2"] } },
        data: expect.objectContaining({
          status: OrderStatus.COMPLETED,
        }),
      })
    );
    expect(customerSessionUpdateManyMock).toHaveBeenCalledTimes(2);
  });

  it("returns message that all orders were already completed when order_id is SEMUA and active orders is empty", async () => {
    orderFindManyMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ order_id: "SEMUA", action: "MARK_COMPLETED" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toContain("Semua pesanan memang sudah berstatus selesai sebelumnya");
    expect(orderUpdateManyMock).not.toHaveBeenCalled();
  });
});
