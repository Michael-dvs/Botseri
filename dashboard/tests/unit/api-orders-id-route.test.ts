import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "@/app/api/orders/[id]/route";
import { OrderPaymentStatus, OrderStatus } from "@prisma/client";

const {
  orderFindUniqueMock,
  orderUpdateMock,
  customerSessionFindManyMock,
  customerSessionUpdateManyMock,
  customerSessionUpdateMock,
} = vi.hoisted(() => ({
  orderFindUniqueMock: vi.fn(),
  orderUpdateMock: vi.fn(),
  customerSessionFindManyMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
  customerSessionUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    order: {
      findUnique: (...args: unknown[]) => orderFindUniqueMock(...args),
      update: (...args: unknown[]) => orderUpdateMock(...args),
    },
    customerSession: {
      findMany: (...args: unknown[]) => customerSessionFindManyMock(...args),
      updateMany: (...args: unknown[]) => customerSessionUpdateManyMock(...args),
      update: (...args: unknown[]) => customerSessionUpdateMock(...args),
    },
  },
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/orders/d5be382f-1234-4567-8901-abcdef123456", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/orders/[id]", () => {
  const fakeId = "d5be382f-1234-4567-8901-abcdef123456";

  beforeEach(() => {
    vi.clearAllMocks();
    customerSessionFindManyMock.mockResolvedValue([]);
    customerSessionUpdateMock.mockResolvedValue({});
  });
  it("updates order and auto-unmutes customer session when status is COMPLETED", async () => {
    const existingOrder = {
      id: fakeId,
      customer_name: "Michael Aristyo",
      customer_contact: "+628123456789",
      description: "Buket Bunga",
      event_date: new Date(),
      delivery_date: null,
      delivery_address: "Jakarta",
      total_amount: 150000,
      dp_amount: 50000,
      payment_status: OrderPaymentStatus.PAID,
      status: OrderStatus.IN_PROGRESS,
      completed_at: null,
      notes: null,
    };

    orderFindUniqueMock.mockResolvedValue(existingOrder);
    orderUpdateMock.mockResolvedValue({
      ...existingOrder,
      status: OrderStatus.COMPLETED,
      completed_at: new Date(),
    });

    const res = await PATCH(makeRequest({ status: "COMPLETED" }), { params: { id: fakeId } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fakeId },
        data: expect.objectContaining({
          status: "COMPLETED",
        }),
      })
    );
    expect(customerSessionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phone_e164: { in: expect.arrayContaining(["628123456789", "+628123456789"]) },
          state: "PAUSED_FOR_OWNER",
        },
      })
    );
  });

  it("does not auto-unmute when status is not COMPLETED", async () => {
    const existingOrder = {
      id: fakeId,
      customer_name: "Michael Aristyo",
      customer_contact: "+628123456789",
      description: "Buket Bunga",
      event_date: new Date(),
      delivery_date: null,
      delivery_address: "Jakarta",
      total_amount: 150000,
      dp_amount: 50000,
      payment_status: OrderPaymentStatus.PAID,
      status: OrderStatus.PENDING,
      completed_at: null,
      notes: null,
    };

    orderFindUniqueMock.mockResolvedValue(existingOrder);
    orderUpdateMock.mockResolvedValue({
      ...existingOrder,
      status: OrderStatus.IN_PROGRESS,
    });

    const res = await PATCH(makeRequest({ status: "IN_PROGRESS" }), { params: { id: fakeId } });
    expect(res.status).toBe(200);
    expect(customerSessionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("soft-deletes order on DELETE, sets deleted_at and CANCELLED, and un-mutes customer", async () => {
    const existingOrder = {
      id: fakeId,
      customer_name: "Michael Aristyo",
      customer_contact: "+628123456789",
      status: OrderStatus.IN_PROGRESS,
      deleted_at: null,
    };

    orderFindUniqueMock.mockResolvedValue(existingOrder);
    orderUpdateMock.mockResolvedValue({
      ...existingOrder,
      status: OrderStatus.CANCELLED,
      deleted_at: new Date(),
    });

    const req = new Request(`http://localhost:3000/api/orders/${fakeId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: { id: fakeId } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fakeId },
        data: expect.objectContaining({
          status: "CANCELLED",
          deleted_at: expect.any(Date),
        }),
      })
    );
    expect(customerSessionFindManyMock).toHaveBeenCalled();
  });

  it("restores soft-deleted order on PATCH with restore: true", async () => {
    const existingOrder = {
      id: fakeId,
      customer_name: "Michael Aristyo",
      customer_contact: "+628123456789",
      status: OrderStatus.CANCELLED,
      deleted_at: new Date(),
    };

    orderFindUniqueMock.mockResolvedValue(existingOrder);
    orderUpdateMock.mockResolvedValue({
      ...existingOrder,
      deleted_at: null,
      status: OrderStatus.PENDING,
    });

    const res = await PATCH(makeRequest({ restore: true }), { params: { id: fakeId } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fakeId },
        data: {
          deleted_at: null,
          status: "PENDING",
        },
      })
    );
  });
});
