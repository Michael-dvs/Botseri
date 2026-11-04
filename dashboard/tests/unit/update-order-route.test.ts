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
  pendingConfirmationCreateMock,
  authorizedNumberFindFirstMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  orderFindUniqueMock: vi.fn(),
  orderDeleteMock: vi.fn(),
  orderUpdateMock: vi.fn(),
  orderFindManyMock: vi.fn(),
  orderUpdateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
  pendingConfirmationCreateMock: vi.fn(),
  authorizedNumberFindFirstMock: vi.fn(),
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
    pendingConfirmation: {
      create: (...args: unknown[]) => pendingConfirmationCreateMock(...args),
    },
    authorizedNumber: {
      findFirst: (...args: unknown[]) => authorizedNumberFindFirstMock(...args),
    },
    systemEvent: {
      create: vi.fn(),
    },
    order: {
      findUnique: (...args: unknown[]) => orderFindUniqueMock(...args),
      findFirst: (...args: unknown[]) => orderFindUniqueMock(...args),
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
    authorizedNumberFindFirstMock.mockResolvedValue({
      chat_id: "6281234567890@c.us",
      is_owner: true,
      is_primary: true,
    });
    pendingConfirmationCreateMock.mockResolvedValue({ id: "conf-1" });
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
        notes: fakeOrder.notes,
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
      notes: null as string | null,
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
        notes: fakeOrder.notes,
      },
    });
  });

  it("requires confirmation when action is CANCEL", async () => {
    const fakeOrder = {
      id: "40e6713c-aaaa-bbbb-cccc-ddddeeeeffff",
      customer_name: "Rina S",
      customer_contact: "+628777777777",
      status: OrderStatus.PENDING,
      description: "Buket Mawar",
      notes: null,
    };

    queryRawMock.mockResolvedValue([{ id: fakeOrder.id }]);
    orderFindUniqueMock.mockResolvedValue(fakeOrder);

    const res = await POST(makeRequest({ order_id: "40E6713C", action: "CANCEL" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.requires_confirmation).toBe(true);
    expect(data.action).toBe("CANCEL");
    expect(data.preview).toContain("Konfirmasi BATALKAN pesanan");
    expect(pendingConfirmationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CANCEL",
        }),
      })
    );
  });

  it("requires confirmation when action is DELETE", async () => {
    const fakeOrder = {
      id: "40e6713c-aaaa-bbbb-cccc-ddddeeeeffff",
      customer_name: "Rina S",
      customer_contact: "+628777777777",
      status: OrderStatus.PENDING,
      description: "Buket Mawar",
      notes: null,
    };

    queryRawMock.mockResolvedValue([{ id: fakeOrder.id }]);
    orderFindUniqueMock.mockResolvedValue(fakeOrder);

    const res = await POST(makeRequest({ order_id: "40E6713C", action: "DELETE" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.requires_confirmation).toBe(true);
    expect(data.action).toBe("DELETE");
    expect(data.preview).toContain("Konfirmasi HAPUS pesanan");
    expect(pendingConfirmationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DELETE",
        }),
      })
    );
  });

  it("requires confirmation when order_id is ALL and creates pending confirmation", async () => {
    orderFindManyMock.mockResolvedValue([
      { id: "ord-1", customer_contact: "+628123456789" },
      { id: "ord-2", customer_contact: "081987654321" },
    ]);

    const res = await POST(makeRequest({ order_id: "ALL", action: "MARK_COMPLETED" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.requires_confirmation).toBe(true);
    expect(data.action).toBe("BULK_COMPLETE");
    expect(data.preview).toContain("Konfirmasi eksekusi massal untuk 2 pesanan aktif");
    expect(pendingConfirmationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "BULK_COMPLETE",
        }),
      })
    );
  });

  it("rejects bulk update when active orders exceed 50", async () => {
    const manyOrders = Array.from({ length: 51 }, (_, i) => ({ id: `ord-${i}`, customer_contact: "+6281234567" }));
    orderFindManyMock.mockResolvedValue(manyOrders);

    const res = await POST(makeRequest({ order_id: "ALL", action: "MARK_COMPLETED" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("melebihi batas maksimal eksekusi massal");
  });

  it("returns ambiguous: true with candidate list when short prefix matches multiple orders", async () => {
    queryRawMock.mockResolvedValue([
      { id: "d5be382f-1", customer_name: "Michael", description: "Buket Lily" },
      { id: "d5be382f-2", customer_name: "Mika", description: "Buket Mawar" },
    ]);

    const res = await POST(makeRequest({ order_id: "D5", action: "MARK_COMPLETED" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.ambiguous).toBe(true);
    expect(data.candidates).toHaveLength(2);
    expect(data.message).toContain("Ditemukan lebih dari 1 pesanan");
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
