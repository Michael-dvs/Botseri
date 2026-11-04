import type { CustomerSessionState } from "@prisma/client";
import type {
  PipelineConfigData,
  PipelineGraph,
  PipelineGraphNode,
} from "./schema";
import { renderPipelineTemplate } from "./manager";
import { recordEvent } from "@/lib/events";
import { projectCoreConfig } from "./projector";
import { looksLikeOrderForm, parseOrderForm } from "@/lib/customer/orderFormat";

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
export interface SimulationResult {
  visited_node_ids: string[];
  active_edge_ids: string[];
  replies: string[];
  next_state: CustomerSessionState;
  log: string[];
  active_router_id?: string;
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

/**
 * Pure simulation function for the canvas "Execute Workflow Simulator" bar.
 * Accurately tracks visited nodes and edges based on input text, session state, and sender role.
 */
export function simulatePipelineExecution(
  config: PipelineConfigData,
  inputMessage: string,
  currentState: CustomerSessionState = "INIT",
  senderRole: "CUSTOMER" | "OWNER" = "CUSTOMER",
  currentRouterId?: string
): SimulationResult {
  const visited: string[] = ["node-trigger"];
  const activeEdges: string[] = [];
  const replies: string[] = [];
  const log: string[] = [];

  const graph = config.graph || { nodes: [], edges: [] };
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  const sampleVars = {
    customer_name: "Pelanggan",
    customer_phone: "+6281234567890",
    last_message: inputMessage,
  };

  function recordStep(source: string, target: string, handle?: string) {
    const edge = graph.edges.find(
      (e) => e.source === source && e.target === target && (!handle || e.sourceHandle === handle)
    );
    if (edge) activeEdges.push(edge.id);
    if (nodeIds.has(target)) visited.push(target);
  }

  // Role OWNER simulation
  if (senderRole === "OWNER") {
    recordStep("node-trigger", "node-owner-ai", "out_owner");

    log.push("Pesan owner diarahkan ke Asisten Operasional Internal.");
    replies.push("Halo Owner! Asisten operasional Botseri siap membantu agenda Anda.");
    return {
      visited_node_ids: visited,
      active_edge_ids: activeEdges,
      replies,
      next_state: currentState,
      log,
    };
  }

  // Role CUSTOMER simulation
  if (!config.inbound_gate.allow_unregistered_customers) {
    log.push("Pintu masuk ditutup untuk pelanggan publik (allow_unregistered_customers: false).");
    return {
      visited_node_ids: visited,
      active_edge_ids: activeEdges,
      replies: [],
      next_state: currentState,
      log,
    };
  }

  // Resolve initial trigger and greeting node via edge tracing
  const triggerNode =
    graph.nodes.find((n) => n.type === "TRIGGER_INBOUND" || n.id === "node-trigger") ||
    graph.nodes[0];

  const customerEdge = graph.edges.find(
    (e) =>
      (e.source === triggerNode?.id || e.source === "node-trigger") &&
      (e.sourceHandle === "out_customer" || e.sourceHandle === "Pelanggan Baru" || !e.sourceHandle)
  );

  const initialGreetingNode = customerEdge
    ? graph.nodes.find((n) => n.id === customerEdge.target)
    : graph.nodes.find((n) => n.id === "node-greeting");

  if (customerEdge) activeEdges.push(customerEdge.id);
  if (initialGreetingNode && !visited.includes(initialGreetingNode.id)) {
    visited.push(initialGreetingNode.id);
  }

  const isForm = looksLikeOrderForm(inputMessage);

  if (isForm) {
    // Direct order form path
    recordStep("node-greeting", "node-router", "out_next");
    recordStep("node-router", "node-order-form", "branch_1");

    const parsed = parseOrderForm(inputMessage);
    const required = config.order_form.required_fields || ["nama_pemesan", "jenis_pesanan", "tanggal_acara", "alamat"];
    const missing = required.filter((f) => {
      if (f === "tanggal_acara") return !parsed.fields.tanggal_acara || !parsed.fields.parsed_date;
      return !parsed.fields[f as keyof typeof parsed.fields];
    });

    if (missing.length === 0) {
      recordStep("node-order-form", "node-fulfillment", "out_valid");

      log.push("Formulir pesanan lengkap. Pesanan tersimpan.");
      replies.push(
        renderPipelineTemplate(config.order_confirmation.customer_confirmation_template, {
          order_id: "#ORD-SIMULASI",
          customer_name: parsed.fields.nama_pemesan || "Pelanggan",
          service_type: parsed.fields.jenis_pesanan || "Buket Bunga",
          event_date: parsed.fields.tanggal_acara || "15 Des 2026",
          delivery_time: parsed.fields.jam_pengiriman || "14:00 WIB",
          delivery_address: parsed.fields.alamat || "Jakarta",
          special_notes: parsed.fields.request_khusus || "-",
        })
      );
      return {
        visited_node_ids: visited,
        active_edge_ids: activeEdges,
        replies,
        next_state: "ACTIVE",
        log,
      };
    } else {
      log.push(`Formulir kurang lengkap: ${missing.join(", ")}`);
      replies.push(`${config.order_form.missing_fields_prefix}\n${missing.map((m) => `• ${m}`).join("\n")}`);
      return {
        visited_node_ids: visited,
        active_edge_ids: activeEdges,
        replies,
        next_state: "AWAITING_ORDER",
        log,
      };
    }
  }

  // Normal text interaction
  if (currentState === "INIT" || currentState === "ACTIVE") {
    log.push("Mengirimkan sapaan & menu interaktif pelanggan.");
    const welcomeText =
      (initialGreetingNode ? extractNodeMessageText(initialGreetingNode) : "") ||
      config.customer_greeting.greeting_text;
    replies.push(renderPipelineTemplate(welcomeText, sampleVars));
    return {
      visited_node_ids: visited,
      active_edge_ids: activeEdges,
      replies,
      next_state: "AWAITING_CHOICE",
      log,
    };
  }

  if (currentState === "AWAITING_CHOICE") {
    // 1. Resolve active router node
    let routerNode: PipelineGraphNode | undefined = undefined;

    if (currentRouterId) {
      routerNode = graph.nodes.find((n) => n.id === currentRouterId);
    }

    if (!routerNode) {
      const greetingEdge = graph.edges.find(
        (e) => e.source === "node-greeting" && (e.sourceHandle === "out_next" || !e.sourceHandle)
      );
      if (greetingEdge) {
        routerNode = graph.nodes.find(
          (n) => n.id === greetingEdge.target && n.type === "CONDITION_ROUTER"
        );
      }
    }

    if (!routerNode) {
      routerNode = graph.nodes.find(
        (n) => n.id === "node-router" || n.type === "CONDITION_ROUTER"
      );
    }

    const routerId = routerNode?.id || "node-router";
    if (!currentRouterId && routerNode) {
      recordStep("node-greeting", routerId, "out_next");
    }

    const routerData = (routerNode?.data as Record<string, unknown>) || {};
    const branches = Array.isArray(routerData.branches)
      ? (routerData.branches as Array<{ id: string; label: string; keywords: string[] }>)
      : null;

    const lowerInput = inputMessage.toLowerCase().trim();

    // 2. Check custom branches first (e.g. branch_3, branch_4)
    if (branches) {
      for (const branch of branches) {
        if (branch.id === "branch_1" || branch.id === "branch_2") continue;
        const isMatch = Array.isArray(branch.keywords) && branch.keywords.some((kw) => {
          const cleanKw = String(kw).toLowerCase().trim();
          if (!cleanKw) return false;
          return lowerInput === cleanKw || new RegExp(`\\b${cleanKw}\\b`, "i").test(lowerInput);
        });

        const branchEdge = graph.edges.find(
          (e) => e.source === routerId && (e.sourceHandle === branch.id || (!e.sourceHandle && branch.id === "branch_3"))
        );

        if (branchEdge && isMatch) {
          activeEdges.push(branchEdge.id);
          visited.push(branchEdge.target);

          const targetNode = graph.nodes.find((n) => n.id === branchEdge.target);

          // Chained custom execution
          const chainedReplies = executeChainedCustomNodes(
            routerId,
            branch.id,
            graph,
            sampleVars
          );

          if (chainedReplies.length > 0) {
            for (const r of chainedReplies) {
              replies.push(r.text);
            }
          } else if (targetNode) {
            const rawMsg = extractNodeMessageText(targetNode);
            if (rawMsg) {
              replies.push(renderPipelineTemplate(rawMsg, sampleVars));
            }
          }

          // Check if targetNode connects to another CONDITION_ROUTER (nested sub-router)
          let nextActiveRouterId: string | undefined = undefined;
          if (targetNode) {
            const chainedEdge = graph.edges.find(
              (e) => e.source === targetNode.id && (e.sourceHandle === "out_next" || !e.sourceHandle)
            );
            if (chainedEdge) {
              const chainedRouter = graph.nodes.find(
                (n) => n.id === chainedEdge.target && n.type === "CONDITION_ROUTER"
              );
              if (chainedRouter) {
                activeEdges.push(chainedEdge.id);
                visited.push(chainedRouter.id);
                nextActiveRouterId = chainedRouter.id;
                const routerName = (chainedRouter.data?.label as string) || chainedRouter.id;
                log.push(`Navigasi ke sub-menu: ${routerName}`);
              }
            }
          }

          log.push(`Mengeksekusi cabang (${branch.label}): ${branchEdge.target}`);
          return {
            visited_node_ids: visited,
            active_edge_ids: activeEdges,
            replies,
            next_state: "AWAITING_CHOICE",
            log,
            active_router_id: nextActiveRouterId,
          };
        }
      }
    }

    // 3. Check branch_1 (Order)
    const b1 = branches?.find((b) => b.id === "branch_1");
    const b1Keywords = Array.isArray(b1?.keywords)
      ? b1.keywords
      : config.customer_greeting.order_trigger_keywords;
    const isB1Match = b1Keywords.some((kw) => {
      const cleanKw = String(kw).toLowerCase().trim();
      return lowerInput === cleanKw || new RegExp(`\\b${cleanKw}\\b`, "i").test(lowerInput);
    });

    if (isB1Match) {
      const b1Edge = graph.edges.find(
        (e) => e.source === routerId && e.sourceHandle === "branch_1"
      );
      if (b1Edge) {
        activeEdges.push(b1Edge.id);
        visited.push(b1Edge.target);
        const targetNode = graph.nodes.find((n) => n.id === b1Edge.target);
        const formText =
          extractNodeMessageText(targetNode) || config.order_form.form_template_text;
        replies.push(formText);
        log.push("Pelanggan memilih opsi 1 (Pesan). Mengirim formulir.");
        return {
          visited_node_ids: visited,
          active_edge_ids: activeEdges,
          replies,
          next_state: "AWAITING_ORDER",
          log,
        };
      }
    }

    // 4. Check branch_2 (Tanya)
    const b2 = branches?.find((b) => b.id === "branch_2");
    const b2Keywords = Array.isArray(b2?.keywords)
      ? b2.keywords
      : config.customer_greeting.ask_trigger_keywords;
    const isB2Match = b2Keywords.some((kw) => {
      const cleanKw = String(kw).toLowerCase().trim();
      return lowerInput === cleanKw || new RegExp(`\\b${cleanKw}\\b`, "i").test(lowerInput);
    });

    if (isB2Match) {
      const b2Edge = graph.edges.find(
        (e) => e.source === routerId && e.sourceHandle === "branch_2"
      );
      if (b2Edge) {
        activeEdges.push(b2Edge.id);
        visited.push(b2Edge.target);
        const targetNode = graph.nodes.find((n) => n.id === b2Edge.target);
        const handoverText =
          extractNodeMessageText(targetNode) || config.cs_handover.handover_customer_text;
        replies.push(handoverText);
        log.push("Pelanggan memilih opsi 2 (Tanya). Mengaktifkan handover.");
        return {
          visited_node_ids: visited,
          active_edge_ids: activeEdges,
          replies,
          next_state: "PAUSED_FOR_OWNER",
          log,
        };
      }
    }

    // 5. Unrecognized Choice (Anti-Bisu Fallback)
    const fallbackText =
      (routerData.fallback_reply_text as string) ||
      config.customer_greeting.unrecognized_choice_text;
    replies.push(fallbackText);
    log.push("Input tidak cocok dengan kata kunci menu. Mengirimkan pengingat.");
    return {
      visited_node_ids: visited,
      active_edge_ids: activeEdges,
      replies,
      next_state: "AWAITING_CHOICE",
      log,
      active_router_id: currentRouterId,
    };
  }

  if (currentState === "PAUSED_FOR_OWNER") {
    log.push("Sesi pelanggan sedang dijeda (PAUSED_FOR_OWNER). Bot tetap diam.");
    return {
      visited_node_ids: visited,
      active_edge_ids: activeEdges,
      replies: [],
      next_state: "PAUSED_FOR_OWNER",
      log,
    };
  }

  // Default AWAITING_ORDER without form
  replies.push(config.order_form.form_template_text);
  return {
    visited_node_ids: visited,
    active_edge_ids: activeEdges,
    replies,
    next_state: "AWAITING_ORDER",
    log,
  };
}
