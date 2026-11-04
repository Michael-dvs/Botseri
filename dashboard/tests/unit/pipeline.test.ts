import { beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineConfigSchema } from "@/lib/pipeline/schema";
import {
  PRESETS,
  FLORIST_DECOR_PRESET,
  GENERIC_COMMERCE_PRESET,
  PERSONAL_ASSISTANT_PRESET,
} from "@/lib/pipeline/presets";
import {
  renderPipelineTemplate,
  getActivePipelineConfig,
} from "@/lib/pipeline/manager";
import {
  executeChainedCustomNodes,
  extractNodeMessageText,
  simulatePipelineExecution,
  syncGraphToCoreConfig,
} from "@/lib/pipeline/graph-runner";
import { formatWhatsAppMarkdown } from "@/lib/pipeline/whatsapp-formatter";
import { normalizeCustomBranches } from "@/app/(app)/pipeline/PipelineStudio";

const {
  pipelineFindUniqueMock,
  pipelineUpsertMock,
} = vi.hoisted(() => ({
  pipelineFindUniqueMock: vi.fn(),
  pipelineUpsertMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    pipelineConfig: {
      findUnique: (...args: unknown[]) => pipelineFindUniqueMock(...args),
      upsert: (...args: unknown[]) => pipelineUpsertMock(...args),
    },
  },
}));

describe("Pipeline Config & Manager (Pipeline Studio)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Schema Validation on Presets", () => {
    it("validates FLORIST_DECOR_PRESET successfully", () => {
      const parsed = PipelineConfigSchema.safeParse(FLORIST_DECOR_PRESET);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.inbound_gate.allow_unregistered_customers).toBe(true);
        expect(parsed.data.customer_greeting.order_trigger_keywords).toContain("pesan");
        expect(parsed.data.order_form.required_fields).toContain("nama_pemesan");
      }
    });

    it("validates GENERIC_COMMERCE_PRESET successfully", () => {
      const parsed = PipelineConfigSchema.safeParse(GENERIC_COMMERCE_PRESET);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.inbound_gate.rate_limit_per_minute).toBe(25);
        expect(parsed.data.customer_greeting.order_trigger_keywords).toContain("booking");
      }
    });

    it("validates PERSONAL_ASSISTANT_PRESET successfully", () => {
      const parsed = PipelineConfigSchema.safeParse(PERSONAL_ASSISTANT_PRESET);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.inbound_gate.allow_unregistered_customers).toBe(false);
        expect(parsed.data.customer_greeting.enabled).toBe(false);
        expect(parsed.data.order_form.enabled).toBe(false);
        expect(parsed.data.owner_assistant.enable_order_tools).toBe(false);
      }
    });

    it("all registered presets match PipelineConfigSchema", () => {
      for (const [key, preset] of Object.entries(PRESETS)) {
        const parsed = PipelineConfigSchema.safeParse(preset.config);
        expect(parsed.success).toBe(true);
        expect(preset.key).toBe(key);
      }
    });
  });

  describe("2. renderPipelineTemplate Interpolation", () => {
    it("interpolates variables properly and avoids em dash", () => {
      const template =
        "Pesanan {{order_id}} atas nama {{customer_name}} tanggal {{event_date}} ({{missing_val}}).";
      const rendered = renderPipelineTemplate(template, {
        order_id: "#ORD-9999",
        customer_name: "Anita",
        event_date: "15 Des 2026",
      });

      expect(rendered).toBe(
        "Pesanan #ORD-9999 atas nama Anita tanggal 15 Des 2026 (-)."
      );
      expect(rendered).not.toContain("—");
    });

    it("replaces em dash with middle dot", () => {
      const templateWithEmDash = "Pesanan {{order_id}} — Berhasil diproses";
      const rendered = renderPipelineTemplate(templateWithEmDash, {
        order_id: "#ORD-123",
      });
      expect(rendered).not.toContain("—");
      expect(rendered).toContain("Pesanan #ORD-123 · Berhasil diproses");
    });
  });

  describe("3. getActivePipelineConfig", () => {
    it("returns seeded FLORIST_DECOR when database row is empty", async () => {
      pipelineFindUniqueMock.mockResolvedValue(null);
      pipelineUpsertMock.mockResolvedValue({
        id: 1,
        name: "Pipeline Operasional Berseri",
        preset_key: "FLORIST_DECOR",
        config_json: FLORIST_DECOR_PRESET,
        version: 1,
      });

      const res = await getActivePipelineConfig();
      expect(res.id).toBe(1);
      expect(res.preset_key).toBe("FLORIST_DECOR");
      expect(res.config.inbound_gate.allow_unregistered_customers).toBe(true);
      expect(pipelineUpsertMock).toHaveBeenCalled();
    });

    it("returns parsed config from database row when present", async () => {
      pipelineFindUniqueMock.mockResolvedValue({
        id: 1,
        name: "Custom UMKM",
        preset_key: "GENERIC_COMMERCE",
        config_json: GENERIC_COMMERCE_PRESET,
        version: 5,
      });

      const res = await getActivePipelineConfig();
      expect(res.id).toBe(1);
      expect(res.name).toBe("Custom UMKM");
      expect(res.version).toBe(5);
      expect(res.preset_key).toBe("GENERIC_COMMERCE");
      expect(pipelineUpsertMock).not.toHaveBeenCalled();
    });

    it("auto-heals customer_greeting.greeting_text when contaminated by sub-menu catalog link", async () => {
      pipelineFindUniqueMock.mockResolvedValue({
        id: 1,
        name: "Pipeline Operasional Berseri",
        preset_key: "FLORIST_DECOR",
        config_json: {
          ...FLORIST_DECOR_PRESET,
          customer_greeting: {
            ...FLORIST_DECOR_PRESET.customer_greeting,
            greeting_text: "Halo kak, untuk melihat katalog Berseri dapat melihat dari link drive.google.com/katalog",
          },
        },
        version: 2,
      });

      const res = await getActivePipelineConfig();
      expect(res.config.customer_greeting.greeting_text).toContain("Berseri Florist & Decor");
      expect(res.config.customer_greeting.greeting_text).not.toContain("drive.google.com");
    });

    it("syncGraphToCoreConfig only syncs greeting text from root greeting node and ignores sub-menu MESSAGE_MENU", () => {
      const graphWithSubMenu = {
        nodes: [
          {
            id: "node-trigger",
            type: "TRIGGER_INBOUND" as const,
            position: { x: 0, y: 0 },
            data: {},
          },
          {
            id: "node-greeting",
            type: "MESSAGE_MENU" as const,
            position: { x: 200, y: 0 },
            data: {
              greeting_text: "Halo, selamat datang di Berseri Florist & Decor!",
            },
          },
          {
            id: "custom-message_menu-1197",
            type: "MESSAGE_MENU" as const,
            position: { x: 700, y: 200 },
            data: {
              greeting_text: "Katalog Bunga: drive.google.com/file/d/xyz",
            },
          },
        ],
        edges: [
          { id: "e1", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
          { id: "e2", source: "node-router", target: "custom-message_menu-1197", sourceHandle: "branch_3" },
        ],
      };

      const synced = syncGraphToCoreConfig(graphWithSubMenu, FLORIST_DECOR_PRESET);
      expect(synced.customer_greeting.greeting_text).toBe("Halo, selamat datang di Berseri Florist & Decor!");
      expect(synced.customer_greeting.greeting_text).not.toContain("Katalog");
    });

    it("simulatePipelineExecution in INIT state traces trigger edge and returns root greeting, not sub-menu catalog", () => {
      const graphWithSubMenu = {
        ...FLORIST_DECOR_PRESET,
        graph: {
          nodes: [
            {
              id: "node-trigger",
              type: "TRIGGER_INBOUND" as const,
              position: { x: 0, y: 0 },
              data: { allow_unregistered_customers: true },
            },
            {
              id: "node-greeting",
              type: "MESSAGE_MENU" as const,
              position: { x: 200, y: 0 },
              data: {
                greeting_text: "Halo, selamat datang di Berseri Florist & Decor!",
              },
            },
            {
              id: "custom-message_menu-1197",
              type: "MESSAGE_MENU" as const,
              position: { x: 700, y: 200 },
              data: {
                greeting_text: "Katalog Bunga: drive.google.com/file/d/xyz",
              },
            },
          ],
          edges: [
            { id: "e1", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
          ],
        },
      };

      const sim = simulatePipelineExecution(graphWithSubMenu, "halo", "INIT", "CUSTOMER");
      expect(sim.replies[0]).toBe("Halo, selamat datang di Berseri Florist & Decor!");
      expect(sim.replies[0]).not.toContain("Katalog");
      expect(sim.visited_node_ids).toContain("node-greeting");
      expect(sim.visited_node_ids).not.toContain("custom-message_menu-1197");
    });
  });

  describe("4. Graph Structure on Presets", () => {
    it("contains valid nodes and edges layout in all 3 presets", () => {
      for (const [key, preset] of Object.entries(PRESETS)) {
        expect(preset.config.graph).toBeDefined();
        expect(preset.config.graph?.nodes.length).toBeGreaterThanOrEqual(7);
        expect(preset.config.graph?.edges.length).toBeGreaterThanOrEqual(6);

        const nodeIds = preset.config.graph?.nodes.map((n) => n.id);
        expect(nodeIds).toContain("node-trigger");
        expect(nodeIds).toContain("node-greeting");
        expect(nodeIds).toContain("node-router");
        expect(nodeIds).toContain("node-order-form");
        expect(nodeIds).toContain("node-handover");
        expect(nodeIds).toContain("node-fulfillment");
        expect(nodeIds).toContain("node-owner-ai");
      }
    });
  });

  describe("5. executeChainedCustomNodes & Custom Branching", () => {
    it("executes custom reply node connected to branch_custom", () => {
      const customGraph = {
        nodes: [
          {
            id: "node-router",
            type: "CONDITION_ROUTER" as const,
            position: { x: 760, y: 140 },
            data: {
              branch_custom_keywords: ["3", "katalog"],
            },
          },
          {
            id: "custom-catalog-reply",
            type: "CUSTOM_WA_REPLY" as const,
            position: { x: 1120, y: 400 },
            data: {
              recipient_type: "CUSTOMER",
              message_template: "Halo {{customer_name}}, ini link katalog produk kami: https://berseri.id/katalog",
            },
          },
        ],
        edges: [
          {
            id: "edge-custom-3",
            source: "node-router",
            sourceHandle: "branch_custom",
            target: "custom-catalog-reply",
            targetHandle: "in",
          },
        ],
      };

      const replies = executeChainedCustomNodes(
        "node-router",
        "branch_custom",
        customGraph,
        {
          customer_name: "Maya",
          customer_phone: "+6281234567890",
        }
      );

      expect(replies).toHaveLength(1);
      expect(replies[0].to).toBe("+6281234567890");
      expect(replies[0].text).toContain("https://berseri.id/katalog");
      expect(replies[0].text).toContain("Halo Maya");
    });

    it("chains multiple custom reply nodes in sequence", () => {
      const chainedGraph = {
        nodes: [
          {
            id: "node-fulfillment",
            type: "ORDER_FULFILLMENT" as const,
            position: { x: 1480, y: 60 },
            data: {},
          },
          {
            id: "custom-bonus-reply-1",
            type: "CUSTOM_WA_REPLY" as const,
            position: { x: 1800, y: 60 },
            data: {
              recipient_type: "CUSTOMER",
              message_template: "Bonus voucher untuk order {{order_id}}!",
            },
          },
          {
            id: "custom-bonus-reply-2",
            type: "CUSTOM_WA_REPLY" as const,
            position: { x: 2100, y: 60 },
            data: {
              recipient_type: "PRIMARY_OWNER",
              message_template: "Notifikasi tambahan untuk pesanan {{order_id}}",
            },
          },
        ],
        edges: [
          {
            id: "edge-chain-1",
            source: "node-fulfillment",
            sourceHandle: "out_done",
            target: "custom-bonus-reply-1",
            targetHandle: "in",
          },
          {
            id: "edge-chain-2",
            source: "custom-bonus-reply-1",
            sourceHandle: "out_next",
            target: "custom-bonus-reply-2",
            targetHandle: "in",
          },
        ],
      };

      const replies = executeChainedCustomNodes(
        "node-fulfillment",
        "out_done",
        chainedGraph,
        {
          order_id: "#ORD-9999",
          customer_phone: "+628111",
          owner_phone: "+628999",
        }
      );

      expect(replies).toHaveLength(2);
      expect(replies[0].to).toBe("+628111");
      expect(replies[0].text).toBe("Bonus voucher untuk order #ORD-9999!");
      expect(replies[1].to).toBe("+628999");
      expect(replies[1].text).toBe("Notifikasi tambahan untuk pesanan #ORD-9999");
    });
  });

  describe("6. simulatePipelineExecution Simulator", () => {
    it("simulates Owner sender role correctly", () => {
      const sim = simulatePipelineExecution(
        FLORIST_DECOR_PRESET,
        "Apa agenda hari ini?",
        "ACTIVE",
        "OWNER"
      );
      expect(sim.visited_node_ids).toContain("node-trigger");
      expect(sim.visited_node_ids).toContain("node-owner-ai");
      expect(sim.active_edge_ids).toContain("edge-trigger-owner");
      expect(sim.replies).toHaveLength(1);
    });

    it("simulates Customer choice 1 (Order)", () => {
      const sim = simulatePipelineExecution(
        FLORIST_DECOR_PRESET,
        "1",
        "AWAITING_CHOICE",
        "CUSTOMER"
      );
      expect(sim.visited_node_ids).toContain("node-order-form");
      expect(sim.active_edge_ids).toContain("edge-router-order");
      expect(sim.next_state).toBe("AWAITING_ORDER");
      expect(sim.replies[0]).toContain("FORMAT PESANAN BERSERI");
    });

    it("simulates Customer choice 2 (Handover / Tanya)", () => {
      const sim = simulatePipelineExecution(
        FLORIST_DECOR_PRESET,
        "2",
        "AWAITING_CHOICE",
        "CUSTOMER"
      );
      expect(sim.visited_node_ids).toContain("node-handover");
      expect(sim.active_edge_ids).toContain("edge-router-ask");
      expect(sim.next_state).toBe("PAUSED_FOR_OWNER");
      expect(sim.replies[0]).toContain("jeda sejenak");
    });

    it("simulates dynamic branch routing on custom branch with custom keywords", () => {
      const customPreset = {
        ...FLORIST_DECOR_PRESET,
        graph: {
          nodes: [
            {
              id: "node-trigger",
              type: "TRIGGER_INBOUND" as const,
              position: { x: 0, y: 0 },
              data: { allow_unregistered_customers: true },
            },
            {
              id: "node-greeting",
              type: "MESSAGE_MENU" as const,
              position: { x: 200, y: 0 },
              data: {},
            },
            {
              id: "node-router",
              type: "CONDITION_ROUTER" as const,
              position: { x: 400, y: 0 },
              data: {
                branches: [
                  { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1"] },
                  { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2"] },
                  { id: "branch_3", label: "Cabang 3 (Katalog)", keywords: ["3", "katalog"] },
                  { id: "branch_4", label: "Cabang 4 (Lokasi)", keywords: ["4", "lokasi"] },
                ],
              },
            },
            {
              id: "node-custom-location",
              type: "CUSTOM_WA_REPLY" as const,
              position: { x: 600, y: 200 },
              data: {
                recipient_type: "CUSTOMER",
                message_template: "Lokasi toko kami berada di Jakarta Selatan.",
              },
            },
          ],
          edges: [
            { id: "e1", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
            { id: "e2", source: "node-greeting", target: "node-router", sourceHandle: "out_next" },
            { id: "e-loc", source: "node-router", target: "node-custom-location", sourceHandle: "branch_4" },
          ],
        },
      };

      const sim = simulatePipelineExecution(
        customPreset,
        "lokasi",
        "AWAITING_CHOICE",
        "CUSTOMER"
      );

      expect(sim.visited_node_ids).toContain("node-custom-location");
      expect(sim.active_edge_ids).toContain("e-loc");
      expect(sim.replies[0]).toContain("Jakarta Selatan");
    });

    it("simulates chained MESSAGE_MENU and sets active_router_id without mock strings", () => {
      const chainedPreset = {
        ...FLORIST_DECOR_PRESET,
        graph: {
          nodes: [
            {
              id: "node-trigger",
              type: "TRIGGER_INBOUND" as const,
              position: { x: 0, y: 0 },
              data: { allow_unregistered_customers: true },
            },
            {
              id: "node-greeting",
              type: "MESSAGE_MENU" as const,
              position: { x: 200, y: 0 },
              data: {},
            },
            {
              id: "node-router",
              type: "CONDITION_ROUTER" as const,
              position: { x: 400, y: 0 },
              data: {
                branches: [
                  { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
                  { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
                  { id: "branch_3", label: "Katalog Menu", keywords: ["3", "katalog", "menu"] },
                ],
              },
            },
            {
              id: "node-menu-katalog",
              type: "MESSAGE_MENU" as const,
              position: { x: 700, y: 100 },
              data: {
                greeting_text: "Halo kak, untuk melihat katalog Berseri dapat melihat dari link berikut ya!! 🏷️\n\n1. Pesan Sekarang\n2. Tanya Admin",
              },
            },
            {
              id: "node-router-sub",
              type: "CONDITION_ROUTER" as const,
              position: { x: 950, y: 100 },
              data: {
                label: "Router Sub-Menu Katalog",
                branches: [
                  { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
                  { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
                ],
              },
            },
            {
              id: "node-order-form",
              type: "ORDER_FORM_PROCESSOR" as const,
              position: { x: 1200, y: 60 },
              data: {
                form_template_text: "FORMAT PESANAN BERSERI:\n* Nama Pemesan:",
              },
            },
          ],
          edges: [
            { id: "e1", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
            { id: "e2", source: "node-greeting", target: "node-router", sourceHandle: "out_next" },
            { id: "e-katalog", source: "node-router", target: "node-menu-katalog", sourceHandle: "branch_3" },
            { id: "e-sub-router", source: "node-menu-katalog", target: "node-router-sub", sourceHandle: "out_next" },
            { id: "e-sub-order", source: "node-router-sub", target: "node-order-form", sourceHandle: "branch_1" },
          ],
        },
      };

      const step1 = simulatePipelineExecution(
        chainedPreset,
        "3",
        "AWAITING_CHOICE",
        "CUSTOMER"
      );

      expect(step1.visited_node_ids).toContain("node-menu-katalog");
      expect(step1.visited_node_ids).toContain("node-router-sub");
      expect(step1.active_router_id).toBe("node-router-sub");
      expect(step1.replies[0]).toContain("Halo kak, untuk melihat katalog Berseri dapat melihat dari link berikut ya!! 🏷️");
      expect(step1.replies[0]).not.toContain("Tereksekusi");
      expect(step1.next_state).toBe("AWAITING_CHOICE");

      const step2 = simulatePipelineExecution(
        chainedPreset,
        "1",
        "AWAITING_CHOICE",
        "CUSTOMER",
        step1.active_router_id
      );

      expect(step2.visited_node_ids).toContain("node-order-form");
      expect(step2.next_state).toBe("AWAITING_ORDER");
      expect(step2.replies[0]).toContain("FORMAT PESANAN BERSERI");
    });
  });

  describe("7. WhatsApp Markdown Formatter", () => {
    it("formats WhatsApp formatting tokens to semantic HTML", () => {
      const text = "*Tebal* _Miring_ ~Coret~ ```Kode```\nBaris baru";
      const formatted = formatWhatsAppMarkdown(text);
      expect(formatted).toContain("<strong>Tebal</strong>");
      expect(formatted).toContain("<em>Miring</em>");
      expect(formatted).toContain("<del>Coret</del>");
      expect(formatted).toContain("<code");
      expect(formatted).toContain("Kode</code>");
      expect(formatted).toContain("<br />");
    });
  });
  describe("8. normalizeCustomBranches & Sequential Re-Indexing", () => {
    it("auto-spawns an empty branch when the last branch has content", () => {
      const initial = [
        { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1"] },
        { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2"] },
        { id: "branch_3", label: "Cabang 3 (Kustom)", keywords: ["3", "katalog"], raw_input: "3, katalog" },
      ];

      const { normalizedBranches } = normalizeCustomBranches(initial, []);
      expect(normalizedBranches).toHaveLength(4);
      expect(normalizedBranches[2].id).toBe("branch_3");
      expect(normalizedBranches[3].id).toBe("branch_4");
      expect(normalizedBranches[3].label).toBe("Cabang 4 (Kustom)");
      expect(normalizedBranches[3].keywords).toEqual([]);
    });

    it("re-indexes branches sequentially and remaps edge handles on delete", () => {
      // Suppose we have branch_3 (katalog) and branch_4 (lokasi) and branch_5 (empty)
      const initial = [
        { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1"] },
        { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2"] },
        { id: "branch_3", label: "Cabang 3 (Kustom)", keywords: ["3", "katalog"], raw_input: "3, katalog" },
        { id: "branch_4", label: "Cabang 4 (Kustom)", keywords: ["4", "lokasi"], raw_input: "4, lokasi" },
      ];
      const edges = [
        { id: "e-katalog", source: "node-router", target: "node-cat", sourceHandle: "branch_3" },
        { id: "e-lokasi", source: "node-router", target: "node-loc", sourceHandle: "branch_4" },
      ];

      // User deletes branch_3
      const afterDelete = initial.filter((b) => b.id !== "branch_3");
      const { normalizedBranches, updatedEdges } = normalizeCustomBranches(afterDelete, edges, "node-router");

      // "lokasi" should now become branch_3!
      expect(normalizedBranches).toHaveLength(4);
      expect(normalizedBranches[2].id).toBe("branch_3");
      expect(normalizedBranches[2].label).toBe("Cabang 3 (Kustom)");
      expect(normalizedBranches[2].keywords).toEqual(["4", "lokasi"]);
      expect(normalizedBranches[3].id).toBe("branch_4");
      expect(normalizedBranches[3].keywords).toEqual([]);

      // Edge that was pointing to branch_4 should be remapped to branch_3!
      const remappedLocEdge = updatedEdges.find((e) => e.id === "e-lokasi");
      expect(remappedLocEdge?.sourceHandle).toBe("branch_3");
    });

    it("preserves custom user-defined branch labels and updates edge labels accordingly", () => {
      const branchesWithCustomLabel = [
        { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
        { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
        { id: "branch_3", label: "Katalog Menu", keywords: ["3", "katalog", "menu"] },
      ];
      const edges = [
        { id: "e-katalog", source: "node-router", sourceHandle: "branch_3", target: "node-katalog", label: "Pilihan 3 (Kustom)" } as any,
      ];

      const { normalizedBranches, updatedEdges } = normalizeCustomBranches(
        branchesWithCustomLabel,
        edges,
        "node-router"
      );

      expect(normalizedBranches[2].label).toBe("Katalog Menu");
      const edge = updatedEdges.find((e) => e.id === "e-katalog");
      expect(edge?.label).toBe("Pilihan · Katalog Menu");
    });
  });

  describe("9. extractNodeMessageText (Polymorphic Extractor)", () => {
    it("extracts text correctly across all node types", () => {
      expect(extractNodeMessageText({ type: "MESSAGE_MENU", data: { greeting_text: "Halo Kak" } })).toBe("Halo Kak");
      expect(extractNodeMessageText({ type: "MESSAGE_MENU", data: { message_text: "Menu Kami" } })).toBe("Menu Kami");
      expect(extractNodeMessageText({ type: "CUSTOM_WA_REPLY", data: { message_template: "Pesan Kustom" } })).toBe("Pesan Kustom");
      expect(extractNodeMessageText({ type: "ORDER_FORM_PROCESSOR", data: { form_template_text: "Formulir" } })).toBe("Formulir");
      expect(extractNodeMessageText({ type: "CS_HANDOVER", data: { handover_customer_text: "Jeda" } })).toBe("Jeda");
      expect(extractNodeMessageText(undefined)).toBe("");
    });
  });
});
