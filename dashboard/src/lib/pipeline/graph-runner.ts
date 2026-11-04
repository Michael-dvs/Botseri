import type {
  PipelineConfigData,
  PipelineGraph,
  PipelineGraphNode,
} from "./schema";
import { renderPipelineTemplate } from "./manager";
import { recordEvent } from "@/lib/events";
import { projectCoreConfig } from "./projector";

export interface CustomReplyPayload {
  to: string;
  text: string;
  body: string;
  phone_e164?: string;
  chat_id?: string;
  trigger_type: string;
}


/**
 * Polymorphic message extractor that checks all common text properties
 * across different node types (MESSAGE_MENU, CUSTOM_WA_REPLY, ORDER_FORM_PROCESSOR, CS_HANDOVER, etc.)
 */
export function extractNodeMessageText(
  node: { type?: string; data?: Record<string, unknown> } | undefined | null
): string {
  if (!node || !node.data) return "";

  const data = node.data;
  const rawText =
    data.message_template ||
    data.greeting_text ||
    data.message_text ||
    data.form_template_text ||
    data.handover_customer_text ||
    data.customer_confirmation_template ||
    data.body ||
    "";

  return typeof rawText === "string" ? rawText.trim() : "";
}

/**
 * Synchronizes modifications made on visual canvas nodes back to the core 6 pipeline container objects
 * to guarantee 100% backward compatibility with internal endpoints and existing test suites.
 */
export function syncGraphToCoreConfig(
  graph: PipelineGraph,
  baseConfig: PipelineConfigData
): PipelineConfigData {
  return projectCoreConfig(graph, baseConfig);
}

/**
 * Traverses visual graph edges to execute custom nodes (such as CUSTOM_WA_REPLY).
 * Supports chaining multiple custom reply nodes in sequence.
 */
export function executeChainedCustomNodes(
  startNodeId: string,
  sourceHandle: string | null,
  graph: PipelineGraph | undefined,
  contextVars: Record<string, string>,
  maxDepth = 3,
  visitedNodeIds: Set<string> = new Set<string>()
): CustomReplyPayload[] {
  if (!graph || !graph.edges || !graph.nodes) return [];

  const replies: CustomReplyPayload[] = [];
  const nodeMap = new Map<string, PipelineGraphNode>(
    graph.nodes.map((n) => [n.id, n])
  );

  let currentSourceId = startNodeId;
  let currentHandle = sourceHandle;
  visitedNodeIds.add(startNodeId);

  while (currentSourceId) {
    if (replies.length >= maxDepth) {
      void recordEvent("WARN", "pipeline_runtime", "PIPELINE_CYCLE_GUARD", {
        start_node_id: startNodeId,
        max_depth: maxDepth,
        reason: "CHAIN_DEPTH_EXCEEDED",
      });
      break;
    }

    // Find outgoing edges from current node
    const matchingEdges = graph.edges.filter((e) => {
      if (e.source !== currentSourceId) return false;
      if (currentHandle) {
        return e.sourceHandle === currentHandle;
      }
      return true;
    });

    const nextEdge =
      matchingEdges.length > 0
        ? matchingEdges[0]
        : currentHandle
          ? graph.edges.find((e) => e.source === currentSourceId && !e.sourceHandle)
          : undefined;

    if (!nextEdge) break;

    const targetNode = nodeMap.get(nextEdge.target);
    if (!targetNode) break;

    // Cycle Guard: cegah kunjungan simpul berulang saat runtime
    if (visitedNodeIds.has(targetNode.id)) {
      void recordEvent("WARN", "pipeline_runtime", "PIPELINE_CYCLE_GUARD", {
        start_node_id: startNodeId,
        cycle_node_id: targetNode.id,
        reason: "CYCLE_DETECTED",
      });
      break;
    }
    visitedNodeIds.add(targetNode.id);

    if (targetNode.type === "CUSTOM_WA_REPLY" || targetNode.type === "MESSAGE_MENU") {
      const data = targetNode.data as Record<string, unknown>;
      const rawTemplate = extractNodeMessageText(targetNode);
      if (rawTemplate) {
        const renderedText = renderPipelineTemplate(rawTemplate, contextVars);
        const recipientType = String(data.recipient_type || "CUSTOMER");
        const customPhone = String(data.custom_phone || "");

        let destinationPhone = contextVars.customer_phone || "";
        if (recipientType === "PRIMARY_OWNER") {
          destinationPhone = contextVars.owner_phone || destinationPhone;
        } else if (recipientType === "CUSTOM_NUMBER" && customPhone) {
          destinationPhone = customPhone;
        }

        const digits = destinationPhone.replace(/\D/g, "");
        const chatId = digits ? `${digits}@c.us` : destinationPhone;

        replies.push({
          to: destinationPhone,
          phone_e164: destinationPhone.startsWith("+") ? destinationPhone : (digits ? `+${digits}` : destinationPhone),
          chat_id: chatId,
          body: renderedText,
          text: renderedText,
          trigger_type: "CUSTOMER_REPLY",
        });
      }

      // Advance chain to next node
      currentSourceId = targetNode.id;
      currentHandle = "out_next";
    } else {
      break;
    }
  }

  return replies;
}

export { simulatePipelineExecution, type SimulationResult } from "./simulator";
