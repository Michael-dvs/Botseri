import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/customer/handle/route";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  pipelineFindUnique: vi.fn(),
  ownerFindFirst: vi.fn(),
  messageLogFindFirst: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => mocks.auth(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customerSession: {
      findUnique: (...args: unknown[]) => mocks.sessionFindUnique(...args),
      create: (...args: unknown[]) => mocks.sessionCreate(...args),
      updateMany: (...args: unknown[]) => mocks.sessionUpdateMany(...args),
    },
    pipelineConfig: {
      findUnique: (...args: unknown[]) => mocks.pipelineFindUnique(...args),
    },
    authorizedNumber: {
      findFirst: (...args: unknown[]) => mocks.ownerFindFirst(...args),
    },
    messageLog: {
      findFirst: (...args: unknown[]) => mocks.messageLogFindFirst(...args),
    },
  },
}));

function request(message: string, phone = "+628123456789") {
  mocks.auth.mockReturnValue(true);
  return new Request("http://localhost/api/internal/customer/handle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer_phone: phone, message_text: message, message_id: `message-${message}` }),
  });
}

const session = (state: string, metadata: Record<string, unknown>) => ({
  id: "session-1",
  phone_e164: "+628123456789",
  state,
  metadata,
  paused_at: null,
  customer_name: "Rina",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.messageLogFindFirst.mockResolvedValue(null);
  mocks.pipelineFindUnique.mockResolvedValue({
    id: 1,
    config_json: FLORIST_DECOR_PRESET,
    version: 1,
  });
});

describe("customer handover inquiry context", () => {
  it("stores the opening message in metadata.initial_inquiry for a new INIT session", async () => {
    mocks.sessionFindUnique.mockResolvedValue(null);
    mocks.sessionCreate.mockResolvedValue(session("INIT", {}));

    const response = await POST(request("halo kak, mau pesan bunga mawar 10 tangkai"));

    expect(response.status).toBe(200);
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          initial_inquiry: "halo kak, mau pesan bunga mawar 10 tangkai",
        }),
      }),
    }));
  });
  it("replaces a short greeting with a later substantive message before menu selection", async () => {
    const inquiry = "Saya ingin informasi tentang pilihan bunga untuk acara kampus";
    mocks.sessionFindUnique.mockResolvedValue(session("AWAITING_CHOICE", {
      current_router_id: "node-router",
      retry_count: 0,
      initial_inquiry: "halo",
    }));

    const response = await POST(request(inquiry));

    expect(response.status).toBe(200);
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ initial_inquiry: inquiry }),
      }),
    }));
  });

  it("puts initial_inquiry, not the menu digit, in the primary owner handover alert", async () => {
    const graph = {
      nodes: [
        {
          id: "active-router",
          type: "CONDITION_ROUTER",
          position: { x: 0, y: 0 },
          data: { branches: [{ id: "branch_2", label: "Tanya CS", keywords: ["2"] }] },
        },

        { id: "handover", type: "CS_HANDOVER", position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [{ id: "handover-edge", source: "active-router", sourceHandle: "branch_2", target: "handover" }],
    };
    mocks.pipelineFindUnique.mockResolvedValue({
      id: 1,
      config_json: { ...FLORIST_DECOR_PRESET, graph },
      version: 1,
    });
    mocks.sessionFindUnique.mockResolvedValue(session("AWAITING_CHOICE", {
      current_router_id: "active-router",
      retry_count: 0,
      initial_inquiry: "halo kak, mau pesan bunga mawar 10 tangkai",
    }));
    mocks.ownerFindFirst.mockResolvedValue({
      id: "owner-1",
      phone_e164: "+628999999999",
      chat_id: "628999999999@c.us",
      is_primary: true,
      is_owner: true,
    });

    const response = await POST(request("2"));
    const body = await response.json();
    const ownerAlert = body.replies.find((reply: { to: string }) => reply.to === "+628999999999");

    expect(response.status).toBe(200);
    expect(ownerAlert.text).toContain("*Halo Minri! Ada Pelanggan Butuh Bantuan!!*");
    expect(ownerAlert.text).toContain('"halo kak, mau pesan bunga mawar 10 tangkai"');
    expect(ownerAlert.text).not.toContain('"2"');
  });
  it("uses initial_inquiry in the 3-strike owner alert instead of the third menu response", async () => {
    const inquiry = "Saya ingin konsultasi untuk buket bunga wisuda";
    mocks.sessionFindUnique.mockResolvedValue(session("AWAITING_CHOICE", {
      current_router_id: "node-router",
      retry_count: 2,
      initial_inquiry: inquiry,
    }));
    mocks.ownerFindFirst.mockResolvedValue({
      id: "owner-1",
      phone_e164: "+628999999999",
      chat_id: "628999999999@c.us",
      is_primary: true,
      is_owner: true,
    });

    const response = await POST(request("4"));
    const body = await response.json();
    const ownerAlert = body.replies.find((reply: { to: string }) => reply.to === "+628999999999");

    expect(body.state_after).toBe("PAUSED_FOR_OWNER");
    expect(ownerAlert.text).toContain(`"${inquiry}"`);
    expect(ownerAlert.text).not.toContain('"4"');
  });

});
