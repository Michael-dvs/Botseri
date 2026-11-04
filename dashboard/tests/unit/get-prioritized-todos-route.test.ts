import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/tools/get-prioritized-todos/route";
import { OrderStatus } from "@prisma/client";

const {
  authMock,
  botSettingsFindUniqueOrThrowMock,
  queryRawMock,
  todoCountMock,
  orderFindManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  botSettingsFindUniqueOrThrowMock: vi.fn(),
  queryRawMock: vi.fn(),
  todoCountMock: vi.fn(),
  orderFindManyMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    botSettings: {
      findUniqueOrThrow: (...args: unknown[]) => botSettingsFindUniqueOrThrowMock(...args),
    },
    todo: {
      count: (...args: unknown[]) => todoCountMock(...args),
    },
    order: {
      findMany: (...args: unknown[]) => orderFindManyMock(...args),
    },
  },
}));

function makeRequest(body: Record<string, unknown> = {}, authorized = true) {
  authMock.mockReturnValue(authorized);
  return new Request("http://localhost:3000/api/internal/tools/get-prioritized-todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/tools/get-prioritized-todos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    botSettingsFindUniqueOrThrowMock.mockResolvedValue({
      id: 1,
      timezone: "Asia/Jakarta",
    });
    queryRawMock.mockResolvedValue([]);
    todoCountMock.mockResolvedValue(0);
    orderFindManyMock.mockResolvedValue([]);
  });

  it("returns 401 if unauthorized", async () => {
    const res = await POST(makeRequest({}, false));
    expect(res.status).toBe(401);
  });

  it("filters upcoming_orders strictly to PENDING and IN_PROGRESS with event_date gte startOfDayWib", async () => {
    await POST(makeRequest({}));

    expect(orderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS],
          },
          event_date: expect.objectContaining({
            gte: expect.any(Date),
          }),
        }),
      })
    );
  });

  it("returns upcoming_orders: [] when all orders are completed or in the past", async () => {
    orderFindManyMock.mockResolvedValue([]);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.upcoming_orders).toEqual([]);
    expect(data.total_upcoming_orders).toBe(0);
  });

  it("maps upcoming active orders cleanly when present", async () => {
    orderFindManyMock.mockResolvedValue([
      {
        id: "d5be382f-1234-4567-8901-abcdef123456",
        customer_name: "Michael Aristyo",
        description: "Buket Bunga Lily",
        event_date: new Date("2026-11-10T10:00:00.000Z"),
        delivery_address: "Jl. Tebet No. 1",
        payment_status: "UNPAID",
      },
    ]);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.upcoming_orders).toHaveLength(1);
    expect(data.upcoming_orders[0].order_id).toBe("#ORD-D5BE382F");
    expect(data.upcoming_orders[0].customer_name).toBe("Michael Aristyo");
    expect(data.total_upcoming_orders).toBe(1);
  });
});
