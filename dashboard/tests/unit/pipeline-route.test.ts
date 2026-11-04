import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/pipeline/route";
import { POST as rollbackPOST } from "@/app/api/pipeline/rollback/route";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";
import type { PipelineConfigData } from "@/lib/pipeline/schema";

const {
  getSessionMock,
  pipelineConfigFindUniqueMock,
  pipelineConfigUpsertMock,
  pipelineConfigVersionFindManyMock,
  pipelineConfigVersionCreateMock,
  pipelineConfigVersionDeleteManyMock,
  pipelineConfigVersionFindFirstMock,
  botSettingsUpdateMock,
  recordEventMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  pipelineConfigFindUniqueMock: vi.fn(),
  pipelineConfigUpsertMock: vi.fn(),
  pipelineConfigVersionFindManyMock: vi.fn(),
  pipelineConfigVersionCreateMock: vi.fn(),
  pipelineConfigVersionDeleteManyMock: vi.fn(),
  pipelineConfigVersionFindFirstMock: vi.fn(),
  botSettingsUpdateMock: vi.fn(),
  recordEventMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    pipelineConfig: {
      findUnique: (...args: unknown[]) => pipelineConfigFindUniqueMock(...args),
      upsert: (...args: unknown[]) => pipelineConfigUpsertMock(...args),
    },
    pipelineConfigVersion: {
      findMany: (...args: unknown[]) => pipelineConfigVersionFindManyMock(...args),
      create: (...args: unknown[]) => pipelineConfigVersionCreateMock(...args),
      deleteMany: (...args: unknown[]) => pipelineConfigVersionDeleteManyMock(...args),
      findFirst: (...args: unknown[]) => pipelineConfigVersionFindFirstMock(...args),
    },
    botSettings: {
      update: (...args: unknown[]) => botSettingsUpdateMock(...args),
    },
  },
}));

describe("S06: Pipeline API Routes (Validation, Optimistic Lock & Rollback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ sub: "user-1", username: "owner" });
    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline Operasional Berseri",
      preset_key: "FLORIST_DECOR",
      version: 5,
      config_json: FLORIST_DECOR_PRESET,
    });
    pipelineConfigUpsertMock.mockResolvedValue({
      id: 1,
      name: "Pipeline Operasional Berseri",
      preset_key: "FLORIST_DECOR",
      version: 6,
    });
    pipelineConfigVersionFindManyMock.mockResolvedValue([]);
    pipelineConfigVersionCreateMock.mockResolvedValue({ id: "ver-6", version: 6 });
    botSettingsUpdateMock.mockResolvedValue({});
    recordEventMock.mockResolvedValue({});
  });

  function makePutRequest(body: unknown): Request {
    return new Request("http://localhost:3000/api/pipeline", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function makeRollbackRequest(body: unknown): Request {
    return new Request("http://localhost:3000/api/pipeline/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("1. Menolak graf siklik dengan HTTP 422 Unprocessable Entity", async () => {
    const cyclicConfig: PipelineConfigData = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          {
            id: "node-trigger",
            type: "TRIGGER_INBOUND",
            position: { x: 0, y: 0 },
            data: {},
          },
          {
            id: "node-a",
            type: "CUSTOM_WA_REPLY",
            position: { x: 100, y: 0 },
            data: { message_template: "Halo A" },
          },
          {
            id: "node-b",
            type: "CUSTOM_WA_REPLY",
            position: { x: 200, y: 0 },
            data: { message_template: "Halo B" },
          },
        ],
        edges: [
          { id: "e1", source: "node-trigger", target: "node-a", sourceHandle: "out_customer" },
          { id: "e2", source: "node-a", target: "node-b", sourceHandle: "out_next" },
          { id: "e3", source: "node-b", target: "node-a", sourceHandle: "out_next" }, // SIKLUS: B -> A -> B
        ],
      },
    };

    const res = await PUT(makePutRequest({
      name: "Pipeline Test",
      preset_key: "FLORIST_DECOR",
      expected_version: 5,
      config: cyclicConfig,
    }));

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.errors).toContainEqual(expect.objectContaining({ code: "GRAPH_CYCLIC" }));
    expect(pipelineConfigUpsertMock).not.toHaveBeenCalled();
  });

  it("2. Menolak graf dengan 2 node TRIGGER_INBOUND dengan HTTP 422", async () => {
    const multiTriggerConfig: PipelineConfigData = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          { id: "trigger-1", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
          { id: "trigger-2", type: "TRIGGER_INBOUND", position: { x: 0, y: 100 }, data: {} },
        ],
        edges: [],
      },
    };

    const res = await PUT(makePutRequest({
      expected_version: 5,
      config: multiTriggerConfig,
    }));

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.errors).toContainEqual(expect.objectContaining({ code: "TRIGGER_NOT_SINGLETON" }));
  });

  it("3. Menolak node dengan 2 kabel dari port keluaran yang sama dengan HTTP 422", async () => {
    const multiCableConfig: PipelineConfigData = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
          { id: "node-1", type: "CUSTOM_WA_REPLY", position: { x: 100, y: 0 }, data: { message_template: "1" } },
          { id: "node-2", type: "CUSTOM_WA_REPLY", position: { x: 100, y: 100 }, data: { message_template: "2" } },
        ],
        edges: [
          { id: "e1", source: "node-trigger", target: "node-1", sourceHandle: "out_customer" },
          { id: "e2", source: "node-trigger", target: "node-2", sourceHandle: "out_customer" }, // Cabang ganda port sama
        ],
      },
    };

    const res = await PUT(makePutRequest({
      expected_version: 5,
      config: multiCableConfig,
    }));

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.errors).toContainEqual(expect.objectContaining({ code: "PORT_MULTI_CONNECTION" }));
  });

  it("4. Menolak expected_version usang dengan respons HTTP 409 Conflict", async () => {
    // Current database version adalah 5, tapi request mengirim expected_version 4
    const res = await PUT(makePutRequest({
      expected_version: 4,
      config: FLORIST_DECOR_PRESET,
    }));

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.current_version).toBe(5);
    expect(data.expected_version).toBe(4);
    expect(pipelineConfigUpsertMock).not.toHaveBeenCalled();
  });

  it("5. Pemanggilan POST /api/pipeline/rollback memulihkan versi lama dan menambah versi baru", async () => {
    pipelineConfigVersionFindFirstMock.mockResolvedValue({
      id: "ver-3",
      version: 3,
      config_json: FLORIST_DECOR_PRESET,
      actor: "admin",
    });

    const res = await rollbackPOST(makeRollbackRequest({ version: 3 }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pipeline.version).toBe(6); // current 5 + 1
    expect(pipelineConfigVersionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 6,
          actor: "owner",
        }),
      })
    );
  });
});
