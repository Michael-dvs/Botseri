import type {
  PipelineGraph,
  PipelineGraphNode,
} from "./schema";

export type ValidationErrorCode =
  | "TRIGGER_NOT_SINGLETON"
  | "NODE_ID_DUPLICATE"
  | "NODE_TYPE_INVALID"
  | "EDGE_INVALID_ENDPOINT"
  | "EDGE_INVALID_HANDLE"
  | "PORT_MULTI_CONNECTION"
  | "GRAPH_CYCLIC"
  | "GRAPH_SELF_LOOP"
  | "CHAIN_DEPTH_EXCEEDED"
  | "ROUTER_KEYWORD_CONFLICT"
  | "TEXT_LENGTH_EXCEEDED"
  | "INVALID_TEMPLATE_VARIABLE";

export type ValidationWarningCode =
  | "ROUTER_NO_FALLBACK"
  | "ORPHAN_NODE"
  | "CUSTOMER_PATH_DEAD_END";

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  code: ValidationErrorCode;
  message: string;
}

export interface ValidationWarning {
  nodeId?: string;
  edgeId?: string;
  code: ValidationWarningCode;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const ALLOWED_NODE_TYPES: Record<string, true> = {
  TRIGGER_INBOUND: true,
  MESSAGE_MENU: true,
  CONDITION_ROUTER: true,
  ORDER_FORM_PROCESSOR: true,
  CS_HANDOVER: true,
  ORDER_FULFILLMENT: true,
  CUSTOM_WA_REPLY: true,
  OWNER_AI_AGENT: true,
};

const ALLOWED_TEMPLATE_VARS: Record<string, true> = {
  customer_name: true,
  customer_phone: true,
  order_id: true,
  service_type: true,
  event_date: true,
  delivery_time: true,
  delivery_address: true,
  special_notes: true,
  payment_status: true,
  last_message: true,
  missing_fields: true,
  unread_count: true,
};

/**
 * Validasi server untuk graf alur kerja visual (INV-16).
 * Memblokir penyimpanan graf yang rusak, siklik, tidak bertrigger tunggal, atau tidak aman.
 */
export function validateGraph(graph: PipelineGraph): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  // 1. Validasi Keunikan ID & Tipe Node
  const nodeMap = new Map<string, PipelineGraphNode>();
  let triggerCount = 0;

  for (const node of nodes) {
    if (!node.id || typeof node.id !== "string") {
      errors.push({
        nodeId: node.id,
        code: "NODE_ID_DUPLICATE",
        message: "ID node wajib diisi dan bertipe string.",
      });
      continue;
    }

    if (nodeMap.has(node.id)) {
      errors.push({
        nodeId: node.id,
        code: "NODE_ID_DUPLICATE",
        message: `ID node '${node.id}' terdaftar ganda di dalam graf.`,
      });
    } else {
      nodeMap.set(node.id, node);
    }

    if (!ALLOWED_NODE_TYPES[node.type]) {
      errors.push({
        nodeId: node.id,
        code: "NODE_TYPE_INVALID",
        message: `Tipe node '${node.type}' tidak terdaftar pada enum resmi.`,
      });
    }

    if (node.type === "TRIGGER_INBOUND") {
      triggerCount++;
    }

    // 2. Validasi template teks dan variabel pada node
    const data = (node.data as Record<string, unknown>) || {};
    const textFields: string[] = [];
    if (typeof data.message_template === "string") textFields.push(data.message_template);
    if (typeof data.greeting_text === "string") textFields.push(data.greeting_text);
    if (typeof data.message_text === "string") textFields.push(data.message_text);
    if (typeof data.form_template_text === "string") textFields.push(data.form_template_text);
    if (typeof data.handover_customer_text === "string") textFields.push(data.handover_customer_text);
    if (typeof data.customer_confirmation_template === "string") textFields.push(data.customer_confirmation_template);

    for (const text of textFields) {
      if (text.length > 1500) {
        errors.push({
          nodeId: node.id,
          code: "TEXT_LENGTH_EXCEEDED",
          message: `Teks pada node '${node.id}' melebihi batas maksimal 1500 karakter (${text.length} karakter).`,
        });
      }

      // Deteksi variabel placeholder {{...}}
      const varRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
      let varMatch: RegExpExecArray | null = null;
      while ((varMatch = varRegex.exec(text)) !== null) {
        const varName = varMatch[1];
        if (!ALLOWED_TEMPLATE_VARS[varName]) {
          errors.push({
            nodeId: node.id,
            code: "INVALID_TEMPLATE_VARIABLE",
            message: `Variabel '{{${varName}}}' pada node '${node.id}' tidak terdaftar di sistem.`,
          });
        }
      }
    }

    // 3. Validasi konflik kata kunci pada Router
    if (node.type === "CONDITION_ROUTER") {
      const branches = Array.isArray(data.branches)
        ? (data.branches as Array<{ id: string; label: string; keywords: string[] }>)
        : [];

      const keywordToBranch = new Map<string, string>();
      for (const branch of branches) {
        const keywords = Array.isArray(branch.keywords) ? branch.keywords : [];
        for (const kw of keywords) {
          const cleanKw = String(kw).toLowerCase().trim();
          if (!cleanKw) continue;
          if (keywordToBranch.has(cleanKw)) {
            const conflictBranchId = keywordToBranch.get(cleanKw)!;
            errors.push({
              nodeId: node.id,
              code: "ROUTER_KEYWORD_CONFLICT",
              message: `Kata kunci '${cleanKw}' terdaftar ganda pada cabang '${conflictBranchId}' dan '${branch.id}'.`,
            });
          } else {
            keywordToBranch.set(cleanKw, branch.id);
          }
        }
      }

      // Warning: Router tanpa fallback
      const hasFallbackReply = typeof data.fallback_reply_text === "string" && data.fallback_reply_text.trim().length > 0;
      const hasFallbackBranch = branches.some((b) => b.id === "branch_fallback");
      if (!hasFallbackReply && !hasFallbackBranch) {
        warnings.push({
          nodeId: node.id,
          code: "ROUTER_NO_FALLBACK",
          message: `Router '${node.id}' belum memiliki teks balasan fallback untuk kata kunci yang tidak dikenali.`,
        });
      }
    }
  }

  // Validasi Singleton TRIGGER_INBOUND
  if (triggerCount !== 1) {
    errors.push({
      code: "TRIGGER_NOT_SINGLETON",
      message: `Graf harus memiliki tepat satu node 'TRIGGER_INBOUND' (ditemukan ${triggerCount}).`,
    });
  }

  // 4. Validasi Kabel (Edges)
  const portOutgoingEdges = new Map<string, string[]>();

  for (const edge of edges) {
    // Larangan Self-Loop (A -> A)
    if (edge.source === edge.target) {
      errors.push({
        edgeId: edge.id,
        code: "GRAPH_SELF_LOOP",
        message: `Edge '${edge.id}' menghubungkan node '${edge.source}' ke dirinya sendiri (self-loop).`,
      });
    }

    // Validasi Endpoint Keberadaan Node
    if (!nodeMap.has(edge.source)) {
      errors.push({
        edgeId: edge.id,
        code: "EDGE_INVALID_ENDPOINT",
        message: `Node sumber '${edge.source}' pada edge '${edge.id}' tidak ditemukan di dalam graf.`,
      });
    }

    if (!nodeMap.has(edge.target)) {
      errors.push({
        edgeId: edge.id,
        code: "EDGE_INVALID_ENDPOINT",
        message: `Node tujuan '${edge.target}' pada edge '${edge.id}' tidak ditemukan di dalam graf.`,
      });
    }

    // Validasi Port Tunggal (Satu port keluar maksimal 1 kabel)
    const sourcePortKey = `${edge.source}:${edge.sourceHandle || "default"}`;
    const existingEdges = portOutgoingEdges.get(sourcePortKey) || [];
    existingEdges.push(edge.id);
    portOutgoingEdges.set(sourcePortKey, existingEdges);

    if (existingEdges.length > 1) {
      errors.push({
        edgeId: edge.id,
        code: "PORT_MULTI_CONNECTION",
        message: `Port '${edge.sourceHandle || "default"}' pada node '${edge.source}' memiliki ${existingEdges.length} koneksi kabel keluar (maksimal 1).`,
      });
    }
  }

  // 5. Validasi Siklus Graf via DFS (Cycle Detection)
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      const list = adj.get(edge.source);
      if (list && !list.includes(edge.target)) {
        list.push(edge.target);
      }
    }
  }

  // 0 = unvisited, 1 = visiting (on current recursion stack), 2 = visited
  const visitState = new Map<string, number>();
  for (const node of nodes) {
    visitState.set(node.id, 0);
  }

  let hasCycle = false;
  function dfsCycle(nodeId: string): boolean {
    visitState.set(nodeId, 1);
    const neighbors = adj.get(nodeId) || [];

    for (const neighbor of neighbors) {
      const state = visitState.get(neighbor) || 0;
      if (state === 1) {
        return true;
      }
      if (state === 0) {
        if (dfsCycle(neighbor)) return true;
      }
    }

    visitState.set(nodeId, 2);
    return false;
  }

  for (const node of nodes) {
    if ((visitState.get(node.id) || 0) === 0) {
      if (dfsCycle(node.id)) {
        hasCycle = true;
        break;
      }
    }
  }
  if (hasCycle) {
    errors.push({
      code: "GRAPH_CYCLIC",
      message: "Graf alur kerja memuat siklus (perulangan tanpa henti). Graf wajib berarah dan asiklik (DAG).",
    });
  }

  // 6. Validasi Kedalaman Rantai Maksimal 3 Hop Balasan
  function checkChainDepth(currId: string, depth: number, visitedPath: Set<string>): number {
    if (depth > 3 || visitedPath.size > nodes.length) return depth;
    const neighbors = adj.get(currId) || [];
    if (neighbors.length === 0) return depth;
    let maxSubDepth = depth;

    for (const nextId of neighbors) {
      if (visitedPath.has(nextId)) continue;
      const targetNode = nodeMap.get(nextId);
      const isReplyNode = targetNode?.type === "CUSTOM_WA_REPLY" || targetNode?.type === "MESSAGE_MENU";
      const nextDepth = isReplyNode ? depth + 1 : depth;

      const newVisited = new Set(visitedPath);
      newVisited.add(nextId);
      const resDepth = checkChainDepth(nextId, nextDepth, newVisited);
      maxSubDepth = Math.max(maxSubDepth, resDepth);
    }

    return maxSubDepth;
  }

  const triggerNode = nodes.find((n) => n.type === "TRIGGER_INBOUND");
  // Jalankan perhitungan kedalaman rantai hanya jika graf bebas siklus tak terhingga
  if (!hasCycle && triggerNode) {
    const maxChain = checkChainDepth(triggerNode.id, 0, new Set([triggerNode.id]));
    if (maxChain > 3) {
      errors.push({
        code: "CHAIN_DEPTH_EXCEEDED",
        message: `Rantai pesan otomatis melebihi batas maksimal 3 pesan berturut-turut (${maxChain} pesan).`,
      });
    }
  }

  // 7. Peringatan Orphan Nodes (Node terisolasi yang tidak dapat dijangkau dari trigger)
  if (triggerNode) {
    const reachable = new Set<string>();
    const queue = [triggerNode.id];
    reachable.add(triggerNode.id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = adj.get(curr) || [];
      for (const next of neighbors) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        warnings.push({
          nodeId: node.id,
          code: "ORPHAN_NODE",
          message: `Node '${node.id}' tidak terhubung dari Pintu Masuk (Trigger). Node ini tidak akan pernah dieksekusi.`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
