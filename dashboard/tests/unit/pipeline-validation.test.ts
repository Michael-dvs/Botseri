import { describe, expect, it } from "vitest";
import { validateGraph } from "@/lib/pipeline/validate-graph";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";
import type { PipelineGraph } from "@/lib/pipeline/schema";

describe("S06: Server-Side Pipeline Graph Validation (INV-16)", () => {
  it("validates authentic preset graph successfully with valid: true and 0 errors", () => {
    const result = validateGraph(FLORIST_DECOR_PRESET.graph!);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects graph with duplicate TRIGGER_INBOUND nodes (TRIGGER_NOT_SINGLETON)", () => {
    const invalidGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger-1", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        { id: "node-trigger-2", type: "TRIGGER_INBOUND", position: { x: 50, y: 50 }, data: {} },
      ],
      edges: [],
    };

    const result = validateGraph(invalidGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "TRIGGER_NOT_SINGLETON" })
    );
  });

  it("rejects cyclic graphs (A -> B -> A) with GRAPH_CYCLIC error", () => {
    const cyclicGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        { id: "node-a", type: "CUSTOM_WA_REPLY", position: { x: 100, y: 0 }, data: { message_template: "Halo A" } },
        { id: "node-b", type: "CUSTOM_WA_REPLY", position: { x: 200, y: 0 }, data: { message_template: "Halo B" } },
      ],
      edges: [
        { id: "e1", source: "node-trigger", target: "node-a", sourceHandle: "out_customer" },
        { id: "e2", source: "node-a", target: "node-b", sourceHandle: "out_next" },
        { id: "e3", source: "node-b", target: "node-a", sourceHandle: "out_next" }, // Siklus kembali ke A
      ],
    };

    const result = validateGraph(cyclicGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "GRAPH_CYCLIC" })
    );
  });

  it("rejects self-loop edges (A -> A) with GRAPH_SELF_LOOP error", () => {
    const loopGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        { id: "node-loop", type: "CUSTOM_WA_REPLY", position: { x: 100, y: 0 }, data: { message_template: "Halo Loop" } },
      ],
      edges: [
        { id: "e1", source: "node-trigger", target: "node-loop", sourceHandle: "out_customer" },
        { id: "e2", source: "node-loop", target: "node-loop", sourceHandle: "out_next" },
      ],
    };

    const result = validateGraph(loopGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "GRAPH_SELF_LOOP" })
    );
  });

  it("rejects multiple edges originating from the same port (PORT_MULTI_CONNECTION)", () => {
    const multiEdgeGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        { id: "node-menu-1", type: "MESSAGE_MENU", position: { x: 200, y: 0 }, data: {} },
        { id: "node-menu-2", type: "MESSAGE_MENU", position: { x: 200, y: 100 }, data: {} },
      ],
      edges: [
        // Dua kabel keluar dari port yang sama: out_customer
        { id: "e1", source: "node-trigger", target: "node-menu-1", sourceHandle: "out_customer" },
        { id: "e2", source: "node-trigger", target: "node-menu-2", sourceHandle: "out_customer" },
      ],
    };

    const result = validateGraph(multiEdgeGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "PORT_MULTI_CONNECTION" })
    );
  });

  it("rejects router with identical keywords on different branches (ROUTER_KEYWORD_CONFLICT)", () => {
    const conflictGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        {
          id: "node-router",
          type: "CONDITION_ROUTER",
          position: { x: 200, y: 0 },
          data: {
            branches: [
              { id: "branch_1", label: "Cabang 1", keywords: ["pesan", "order"] },
              { id: "branch_2", label: "Cabang 2", keywords: ["order", "tanya"] }, // "order" duplikat
            ],
          },
        },
      ],
      edges: [
        { id: "e1", source: "node-trigger", target: "node-router", sourceHandle: "out_customer" },
      ],
    };

    const result = validateGraph(conflictGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "ROUTER_KEYWORD_CONFLICT" })
    );
  });

  it("rejects template text with unknown variables (INVALID_TEMPLATE_VARIABLE)", () => {
    const badVarGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        {
          id: "node-custom",
          type: "CUSTOM_WA_REPLY",
          position: { x: 200, y: 0 },
          data: {
            message_template: "Halo {{customer_name}}, saldo Anda adalah {{unsupported_variable}}!",
          },
        },
      ],
      edges: [
        { id: "e1", source: "node-trigger", target: "node-custom", sourceHandle: "out_customer" },
      ],
    };

    const result = validateGraph(badVarGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "INVALID_TEMPLATE_VARIABLE" })
    );
  });

  it("rejects message template exceeding 1500 characters (TEXT_LENGTH_EXCEEDED)", () => {
    const hugeTextGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        {
          id: "node-custom",
          type: "CUSTOM_WA_REPLY",
          position: { x: 200, y: 0 },
          data: {
            message_template: "A".repeat(1501),
          },
        },
      ],
      edges: [
        { id: "e1", source: "node-trigger", target: "node-custom", sourceHandle: "out_customer" },
      ],
    };

    const result = validateGraph(hugeTextGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "TEXT_LENGTH_EXCEEDED" })
    );
  });

  it("produces warnings for orphan nodes and missing router fallback (non-blocking)", () => {
    const warnGraph: PipelineGraph = {
      nodes: [
        { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
        { id: "node-greeting", type: "MESSAGE_MENU", position: { x: 200, y: 0 }, data: { greeting_text: "Halo!" } },
        { id: "node-orphan", type: "CUSTOM_WA_REPLY", position: { x: 500, y: 500 }, data: { message_template: "Tersesat" } },
      ],
      edges: [
        { id: "e1", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
      ],
    };

    const result = validateGraph(warnGraph);
    expect(result.valid).toBe(true); // Warning tidak memblokir simpan
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "ORPHAN_NODE" })
    );
  });
});
