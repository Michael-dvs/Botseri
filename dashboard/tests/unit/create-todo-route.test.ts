import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/internal/tools/create-todo-and-order/route";
import { normalizeIsoDateTime } from "../../src/lib/time";

const {
  authMock,
  botSettingsFindUniqueMock,
  priorityLevelFindManyMock,
  messageLogFindUniqueMock,
  todoFindManyMock,
  createOrderForMessageMock,
  createTodoIdempotentMock,
  syncTodoMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  botSettingsFindUniqueMock: vi.fn(),
  priorityLevelFindManyMock: vi.fn(),
  messageLogFindUniqueMock: vi.fn(),
  todoFindManyMock: vi.fn(),
  createOrderForMessageMock: vi.fn(),
  createTodoIdempotentMock: vi.fn(),
  syncTodoMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    botSettings: {
      findUnique: (...args: unknown[]) => botSettingsFindUniqueMock(...args),
    },
    priorityLevel: {
      findMany: (...args: unknown[]) => priorityLevelFindManyMock(...args),
    },
    messageLog: {
      findUnique: (...args: unknown[]) => messageLogFindUniqueMock(...args),
    },
    todo: {
      findMany: (...args: unknown[]) => todoFindManyMock(...args),
    },
  },
}));

vi.mock("@/lib/todos/create", () => ({
  createOrderForMessage: (...args: unknown[]) => createOrderForMessageMock(...args),
  createTodoIdempotent: (...args: unknown[]) => createTodoIdempotentMock(...args),
}));

vi.mock("@/lib/google/sync", () => ({
  syncTodo: (...args: unknown[]) => syncTodoMock(...args),
}));

const validMsgId = "11111111-2222-4333-a444-555555555555";

function makeReq(body: unknown, authorized = true) {
  return new Request("http://localhost/api/internal/tools/create-todo-and-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/internal/tools/create-todo-and-order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    botSettingsFindUniqueMock.mockResolvedValue({
      id: 1,
      timezone: "Asia/Jakarta",
      default_due_time: "17:00",
    });
    priorityLevelFindManyMock.mockResolvedValue([
      { id: "pl-1", rank: 1, label: "Kritis" },
      { id: "pl-2", rank: 2, label: "Penting" },
    ]);
    messageLogFindUniqueMock.mockResolvedValue({
      id: validMsgId,
      chat_id: "6287881820571@c.us",
    });
    createOrderForMessageMock.mockResolvedValue("order-uuid-1");
    createTodoIdempotentMock.mockResolvedValue({
      todo: {
        id: "todo-uuid-1",
        title: "Kirim bunga mawar",
        priority_rank: 1,
        due_at: new Date("2026-10-23T03:00:00Z"),
        planned_date: new Date("2026-10-23T00:00:00Z"),
        google_sync_status: "NOT_REQUIRED",
      },
      warning: null,
      deduplicated: false,
    });
    todoFindManyMock.mockResolvedValue([
      {
        id: "todo-uuid-1",
        title: "Kirim bunga mawar",
        priority_rank: 1,
        due_at: new Date("2026-10-23T03:00:00Z"),
        planned_date: new Date("2026-10-23T00:00:00Z"),
        google_sync_status: "NOT_REQUIRED",
        priority_level: { label: "Kritis" },
      },
    ]);
  });

  describe("1. Offline Matrix & Schema Normalization", () => {
    it("accepts flat single-todo payload from n8n tool", async () => {
      const res = await POST(
        makeReq({
          source_message_id: validMsgId,
          title: "Kirim bunga mawar ke pelanggan",
          due_at: "2026-10-23T10:00:00+07:00",
          has_specific_time: true,
          priority_rank: 1,
        }),
      );
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(createTodoIdempotentMock).toHaveBeenCalledTimes(1);
      expect(createTodoIdempotentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            title: "Kirim bunga mawar ke pelanggan",
            priority_rank: 1,
            has_specific_time: true,
            due_at: "2026-10-23T10:00:00+07:00",
          }),
        }),
      );
    });

    it("accepts nested todos[] array payload", async () => {
      const res = await POST(
        makeReq({
          source_message_id: validMsgId,
          todos: [
            {
              title: "Tugas 1",
              priority_rank: 2,
              has_specific_time: false,
            },
          ],
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("accepts stringified JSON body and stringified todos array", async () => {
      const payload = JSON.stringify({
        source_message_id: validMsgId,
        todos: JSON.stringify([
          {
            title: "Tugas dari string",
            priority_rank: 1,
          },
        ]),
      });
      const res = await POST(makeReq(payload));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("coerces numeric strings and string booleans", async () => {
      const res = await POST(
        makeReq({
          source_message_id: validMsgId,
          title: "Coerce types test",
          priority_rank: "2",
          has_specific_time: "true",
          due_at: "2026-10-23T10:00:00+07:00",
        }),
      );
      expect(res.status).toBe(200);
      expect(createTodoIdempotentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            priority_rank: 2,
            has_specific_time: true,
          }),
        }),
      );
    });

    it("interprets naive datetime and date-only in Asia/Jakarta timezone", async () => {
      // 1. Date-only
      const res1 = await POST(
        makeReq({
          source_message_id: validMsgId,
          title: "Date only test",
          due_at: "2026-10-23",
        }),
      );
      expect(res1.status).toBe(200);
      expect(createTodoIdempotentMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            due_at: "2026-10-23T00:00:00+07:00",
          }),
        }),
      );

      // 2. Naive datetime without offset
      const res2 = await POST(
        makeReq({
          source_message_id: validMsgId,
          title: "Naive datetime test",
          due_at: "2026-10-23T10:00:00",
        }),
      );
      expect(res2.status).toBe(200);
      expect(createTodoIdempotentMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            due_at: "2026-10-23T10:00:00+07:00",
          }),
        }),
      );

      // 3. UTC datetime with Z
      const res3 = await POST(
        makeReq({
          source_message_id: validMsgId,
          title: "UTC datetime test",
          due_at: "2026-10-23T03:00:00Z",
        }),
      );
      expect(res3.status).toBe(200);
      expect(createTodoIdempotentMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            due_at: "2026-10-23T10:00:00+07:00",
          }),
        }),
      );
    });

    it("returns HTTP 422 when title is missing", async () => {
      const res = await POST(
        makeReq({
          source_message_id: validMsgId,
          priority_rank: 1,
        }),
      );
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error.fields).toContain("title");
    });

    it("returns HTTP 422 when due_at is unparseable garbage", async () => {
      const res = await POST(
        makeReq({
          source_message_id: validMsgId,
          title: "Valid title",
          due_at: "not-a-valid-datetime",
        }),
      );
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error.fields).toContain("todos[0].due_at");
    });

    it("returns HTTP 422 when source_message_id is not a valid UUID", async () => {
      const res = await POST(
        makeReq({
          source_message_id: "invalid-uuid",
          title: "Valid title",
        }),
      );
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error.fields).toContain("source_message_id");
    });
  });

  describe("2. normalizeIsoDateTime helper unit tests", () => {
    it("handles date-only, naive, UTC, and offset strings correctly", () => {
      expect(normalizeIsoDateTime("2026-10-23")).toBe("2026-10-23T00:00:00+07:00");
      expect(normalizeIsoDateTime("2026-10-23T10:00:00")).toBe("2026-10-23T10:00:00+07:00");
      expect(normalizeIsoDateTime("2026-10-23 10:00")).toBe("2026-10-23T10:00:00+07:00");
      expect(normalizeIsoDateTime("2026-10-23T03:00:00Z")).toBe("2026-10-23T10:00:00+07:00");
      expect(normalizeIsoDateTime("2026-10-23T10:00:00+07:00")).toBe("2026-10-23T10:00:00+07:00");
      expect(normalizeIsoDateTime(null)).toBeNull();
      expect(normalizeIsoDateTime("")).toBeNull();
      expect(() => normalizeIsoDateTime("invalid-date")).toThrow();
    });
  });
});
