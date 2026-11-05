import type { CustomerSessionState } from "@prisma/client";
import type {
  PipelineConfigData,
  PipelineGraph,
  PipelineGraphNode,
} from "./schema";
import { renderPipelineTemplate } from "./manager";
import { executeChainedCustomNodes, extractNodeMessageText, findDownstreamRouter } from "./graph-runner";
import { looksLikeOrderForm, parseOrderForm, type OrderDraft } from "@/lib/customer/orderFormat";

export interface PipelineContext {
  config: PipelineConfigData;
  sessionState: CustomerSessionState;
  currentRouterId?: string | null;
  sampleVars?: Record<string, string>;
  senderRole?: "CUSTOMER" | "OWNER";
  draft?: Partial<OrderDraft> | null;
  retryCount?: number;
  pausedExpired?: boolean;
  customerPhone?: string;
}

export interface PipelineInput {
  text: string;
  intent?: "SUBMIT_ORDER" | null;
  customerPhone?: string;
  messageId?: string | null;
}

export type PipelineAction =
  | { type: "SEND_MESSAGE"; to?: string; text: string; trigger_type: string }
  | { type: "UPDATE_SESSION"; nextState: CustomerSessionState; nextRouterId?: string | null; draft?: Record<string, unknown> | null; pausedAt?: Date | null; retryCount?: number }
  | { type: "CREATE_ORDER"; draft: Record<string, unknown> }
  | { type: "CS_HANDOVER"; customerPhone?: string; lastMessage: string }
  | { type: "PAUSE_BOT"; until?: Date | null };

export interface StepResult {
  actions: PipelineAction[];
  nodeTrace: string[];
  activeEdgeIds: string[];
  nextState: CustomerSessionState;
  nextRouterId?: string | null;
  log: string[];
  replies: string[];
}

const DEFAULT_SAMPLE_VARS: Record<string, string> = {
  customer_name: "Maya Anggraini",
  customer_phone: "+6281234567890",
  order_id: "#ORD-8F92A10B",
  service_type: "Buket Mawar Putih",
  event_date: "20 November 2026",
  delivery_time: "14:00 WIB",
  delivery_address: "Jl. Tebet Barat Dalam No. 12, Jakarta Selatan",
  special_notes: "Pita warna emas, kartu ucapan: Selamat Ulang Tahun",
  payment_status: "Belum dibayar",
  last_message: "Bisa kirim buket mawar untuk acara besok jam 2 siang?",
};

/**
 * Mesin pengeksekusi graf alur kerja terpadu (S10 §4).
 * Menyatukan logika runtime (customer/handle) dan simulator studio (PipelineStudio)
 * dalam satu sumber kebenaran murni tanpa duplikasi percabangan.
 */
export function runPipelineStep(
  ctx: PipelineContext,
  input: PipelineInput,
  _options?: { dryRun?: boolean }
): StepResult {
  void _options;
  const config = ctx.config;
  const graph: PipelineGraph = config.graph?.nodes?.length
    ? config.graph
    : { nodes: [], edges: [] };

  const senderRole = ctx.senderRole || "CUSTOMER";
  const effectiveState: CustomerSessionState =
    ctx.sessionState === "PAUSED_FOR_OWNER" && ctx.pausedExpired
      ? "ACTIVE"
      : ctx.sessionState;

  const sampleVars: Record<string, string> = {
    ...DEFAULT_SAMPLE_VARS,
    ...(ctx.customerPhone ? { customer_phone: ctx.customerPhone } : {}),
    ...(input.customerPhone ? { customer_phone: input.customerPhone } : {}),
    ...(ctx.sampleVars || {}),
  };

  const visited: string[] = [];
  const activeEdges: string[] = [];
  const log: string[] = [];
  const actions: PipelineAction[] = [];
  const replies: string[] = [];

  const triggerNode =
    graph.nodes.find((n) => n.type === "TRIGGER_INBOUND" || n.id === "node-trigger") ||
    graph.nodes[0];

  if (triggerNode) {
    visited.push(triggerNode.id);
  }

  // 1. Jalur Owner: Menuju OWNER_AI_AGENT
  if (senderRole === "OWNER") {
    const ownerEdge = graph.edges.find(
      (e) => e.source === triggerNode?.id && (e.sourceHandle === "out_owner" || e.sourceHandle === "Owner Terdaftar")
    );
    if (ownerEdge) {
      activeEdges.push(ownerEdge.id);
      visited.push(ownerEdge.target);
    } else {
      const ownerNode = graph.nodes.find((n) => n.type === "OWNER_AI_AGENT" || n.id === "node-owner-agent");
      if (ownerNode) visited.push(ownerNode.id);
    }
    log.push("Pesan owner diarahkan ke Asisten Operasional Internal.");
    replies.push("Halo Owner! Asisten operasional Botseri siap membantu agenda Anda.");
    return {
      actions: [],
      nodeTrace: visited,
      activeEdgeIds: activeEdges,
      nextState: effectiveState,
      nextRouterId: ctx.currentRouterId,
      log,
      replies,
    };
  }

  // 2. Evaluasi Formulir Pemesanan Langsung (Bisa datang dari state apa pun)
  const isOrderForm =
    input.intent === "SUBMIT_ORDER" || looksLikeOrderForm(input.text);

  if (isOrderForm) {
    const formNode =
      graph.nodes.find((n) => n.type === "ORDER_FORM_PROCESSOR" || n.id === "node-form") ||
      graph.nodes.find((n) => n.type === "ORDER_FORM_PROCESSOR");

    if (formNode) {
      visited.push(formNode.id);
    }

    const currentDraft = (ctx.draft as Record<string, unknown>) || {};
    const parsed = parseOrderForm(input.text);
    const mergedDraft = { ...currentDraft, ...parsed.fields };

    // Periksa kelengkapan field wajib
    if (parsed.missing.length > 0) {
      const missingList = parsed.missing.map((f) => `• ${f}`).join("\n");
      const prefix = config.order_form?.missing_fields_prefix || "Terima kasih Kak! Masih ada data yang belum terisi:";
      const missingReply = `${prefix}\n${missingList}\n\nMohon dilengkapi lalu kirim lagi ya Kak.`;

      replies.push(missingReply);
      actions.push({
        type: "UPDATE_SESSION",
        nextState: "AWAITING_ORDER",
        draft: mergedDraft,
      });
      actions.push({
        type: "SEND_MESSAGE",
        text: missingReply,
        trigger_type: "CUSTOMER_REPLY",
      });
      log.push(`Formulir pesanan belum lengkap (kurang ${parsed.missing.length} field). Meminta kelengkapan.`);

      return {
        actions,
        nodeTrace: visited,
        activeEdgeIds: activeEdges,
        nextState: "AWAITING_ORDER",
        nextRouterId: null,
        log,
        replies,
      };
    }

    // Formulir Lengkap: Menuju ORDER_FULFILLMENT
    const fulfillEdge = graph.edges.find(
      (e) => (e.source === formNode?.id || e.source === "node-form") && e.sourceHandle === "out_valid"
    );
    if (fulfillEdge) {
      activeEdges.push(fulfillEdge.id);
      visited.push(fulfillEdge.target);
    } else {
      const fulfillNode = graph.nodes.find((n) => n.type === "ORDER_FULFILLMENT" || n.id === "node-fulfillment");
      if (fulfillNode) visited.push(fulfillNode.id);
    }

    const fulfillNode = graph.nodes.find((n) => n.type === "ORDER_FULFILLMENT" || n.id === "node-fulfillment");
    const rawConfirm =
      extractNodeMessageText(fulfillNode) ||
      config.order_confirmation?.customer_confirmation_template ||
      "Yeay, pesanan tercatat! No Pesanan: #ORD-8F92A10B";

    const confirmReply = renderPipelineTemplate(rawConfirm, {
      ...sampleVars,
      customer_name: String(mergedDraft.nama_pemesan || sampleVars.customer_name),
      service_type: String(mergedDraft.jenis_pesanan || sampleVars.service_type),
      event_date: String(mergedDraft.tanggal_acara || sampleVars.event_date),
      delivery_address: String(mergedDraft.alamat || sampleVars.delivery_address),
    });

    replies.push(confirmReply);
    actions.push({
      type: "CREATE_ORDER",
      draft: mergedDraft,
    });
    actions.push({
      type: "SEND_MESSAGE",
      text: confirmReply,
      trigger_type: "CUSTOMER_REPLY",
    });
    actions.push({
      type: "UPDATE_SESSION",
      nextState: "ACTIVE",
      draft: null,
      pausedAt: null,
    });
    log.push("Formulir pesanan lengkap berhasil diproses. Mengirim konfirmasi pesanan.");

    return {
      actions,
      nodeTrace: visited,
      activeEdgeIds: activeEdges,
      nextState: "ACTIVE",
      nextRouterId: null,
      log,
      replies,
    };
  }

  // 3. Sesi Sedang Dijeda Manual (PAUSED_FOR_OWNER)
  if (effectiveState === "PAUSED_FOR_OWNER") {
    log.push("Sesi pelanggan sedang dijeda (PAUSED_FOR_OWNER). Bot tetap diam.");
    return {
      actions: [],
      nodeTrace: visited,
      activeEdgeIds: activeEdges,
      nextState: "PAUSED_FOR_OWNER",
      nextRouterId: ctx.currentRouterId,
      log,
      replies: [],
    };
  }

  // 4. Sesi Baru (INIT) atau Percakapan Baru (ACTIVE)
  if (effectiveState === "INIT" || effectiveState === "ACTIVE") {
    const greetingEdge = graph.edges.find(
      (e) => (e.source === triggerNode?.id || e.source === "node-trigger") &&
             (e.sourceHandle === "out_customer" || e.sourceHandle === "Pelanggan Baru" || !e.sourceHandle)
    );
    if (greetingEdge) {
      activeEdges.push(greetingEdge.id);
      visited.push(greetingEdge.target);
    } else {
      const gNode = graph.nodes.find((n) => n.id === "node-greeting" || n.type === "MESSAGE_MENU");
      if (gNode) visited.push(gNode.id);
    }

    const greetingNode =
      (greetingEdge ? graph.nodes.find((n) => n.id === greetingEdge.target) : null) ||
      graph.nodes.find((n) => n.id === "node-greeting" || n.type === "MESSAGE_MENU");

    const greetingText =
      extractNodeMessageText(greetingNode) ||
      config.customer_greeting?.greeting_text ||
      "Halo, selamat datang di Berseri Florist & Decor!";

    let initialRouterId: string | null = null;
    if (greetingNode) {
      const downstreamRouter = findDownstreamRouter(greetingNode.id, graph);
      if (downstreamRouter) {
        initialRouterId = downstreamRouter.id;
      }
    }
    if (!initialRouterId) {
      const firstRouter = graph.nodes.find((n) => n.type === "CONDITION_ROUTER" || n.id === "node-router");
      if (firstRouter) {
        initialRouterId = firstRouter.id;
      }
    }

    replies.push(greetingText);
    actions.push({
      type: "SEND_MESSAGE",
      text: greetingText,
      trigger_type: "CUSTOMER_REPLY",
    });
    actions.push({
      type: "UPDATE_SESSION",
      nextState: "AWAITING_CHOICE",
      nextRouterId: initialRouterId,
    });
    log.push("Pelanggan baru terhubung: Mengirim sapaan & menu.");

    return {
      actions,
      nodeTrace: visited,
      activeEdgeIds: activeEdges,
      nextState: "AWAITING_CHOICE",
      nextRouterId: initialRouterId,
      log,
      replies,
    };
  }

  // 5. State AWAITING_CHOICE: Evaluasi Router Percabangan
  if (effectiveState === "AWAITING_CHOICE") {
    const greetingNode = graph.nodes.find((n) => n.id === "node-greeting" || n.type === "MESSAGE_MENU");
    if (greetingNode) {
      visited.push(greetingNode.id);
    }

    // Resolusi router aktif (sub-router atau router akar)
    let routerNode: PipelineGraphNode | undefined = undefined;
    if (ctx.currentRouterId) {
      const found = graph.nodes.find((n) => n.id === ctx.currentRouterId);
      if (found && found.type === "CONDITION_ROUTER") {
        routerNode = found;
      }
    }
    if (!routerNode) {
      const explicitRootRouter = graph.nodes.find(
        (n) => (n.id === "node-router" || n.id === "root-router") && n.type === "CONDITION_ROUTER"
      );
      if (explicitRootRouter) {
        routerNode = explicitRootRouter;
      }
    }

    if (!routerNode && greetingNode) {
      routerNode = findDownstreamRouter(greetingNode.id, graph);
    }

    if (!routerNode) {
      routerNode = graph.nodes.find((n) => n.type === "CONDITION_ROUTER");
    }

    const routerId = routerNode?.id || "node-router";
    if (routerNode) {
      visited.push(routerNode.id);
      const greetingEdge = graph.edges.find((e) => e.source === "node-greeting" && e.target === routerId);
      if (greetingEdge) activeEdges.push(greetingEdge.id);
    }

    const routerData = (routerNode?.data as Record<string, unknown>) || {};
    const branches = Array.isArray(routerData.branches)
      ? (routerData.branches as Array<{ id: string; label: string; keywords: string[] }>)
      : null;

    const cleanInput = input.text.trim().toLowerCase();

    // 5a. Evaluasi Cabang Kustom terlebih dahulu (mis. branch_3, branch_4, branch_sub_1)
    if (branches) {
      for (const branch of branches) {
        if (branch.id === "branch_1" || branch.id === "branch_2") continue;
        const isBranch3 = branch.id === "branch_3" || branch.id.includes("catalog") || branch.id.includes("katalog");
        const branchKeywords = Array.isArray(branch.keywords) ? branch.keywords : [];
        const isMatch =
          (isBranch3 && cleanInput === "3") ||
          branchKeywords.some((kw) => {
            const cleanKw = String(kw).toLowerCase().trim();
            if (!cleanKw) return false;
            return cleanInput === cleanKw || new RegExp(`\\b${cleanKw}\\b`, "i").test(cleanInput);
          });

        const branchEdge = graph.edges.find(
          (e) =>
            e.source === routerId &&
            (e.sourceHandle === branch.id ||
             e.sourceHandle?.toLowerCase().includes(branch.id.toLowerCase()) ||
             (!e.sourceHandle && branch.id === "branch_3"))
        );

        if (branchEdge && isMatch) {
          activeEdges.push(branchEdge.id);
          visited.push(branchEdge.target);

          const targetNode = graph.nodes.find((n) => n.id === branchEdge.target);
          const chainedReplies = executeChainedCustomNodes(routerId, branch.id, graph, sampleVars);

          if (chainedReplies.length > 0) {
            for (const r of chainedReplies) {
              replies.push(r.text);
              actions.push({
                type: "SEND_MESSAGE",
                text: r.text,
                trigger_type: "CUSTOMER_REPLY",
              });
            }
          } else if (targetNode) {
            const rawMsg = extractNodeMessageText(targetNode);
            if (rawMsg) {
              const rendered = renderPipelineTemplate(rawMsg, sampleVars);
              replies.push(rendered);
              actions.push({
                type: "SEND_MESSAGE",
                text: rendered,
                trigger_type: "CUSTOMER_REPLY",
              });
            }
          }

          // Periksa apakah targetNode (atau rantai simpulnya) terhubung ke sub-router bertingkat
          let nextActiveRouterId: string | undefined = undefined;
          if (targetNode) {
            const chainedRouter = findDownstreamRouter(targetNode.id, graph);
            if (chainedRouter) {
              visited.push(chainedRouter.id);
              nextActiveRouterId = chainedRouter.id;
              log.push(`Navigasi ke sub-menu: ${(chainedRouter.data?.label as string) || chainedRouter.id}`);
            }
          }

          actions.push({
            type: "UPDATE_SESSION",
            nextState: "AWAITING_CHOICE",
            retryCount: 0,
            nextRouterId: nextActiveRouterId || null,
          });
          log.push(`Mengeksekusi cabang (${branch.label}): ${branchEdge.target}`);

          return {
            actions,
            nodeTrace: visited,
            activeEdgeIds: activeEdges,
            nextState: "AWAITING_CHOICE",
            nextRouterId: nextActiveRouterId,
            log,
            replies,
          };
        }
      }
    }

    // 5b. Evaluasi Cabang 1 (Order / Pesan)
    const b1 = branches?.find((b) => b.id === "branch_1");
    const b1Keywords = Array.isArray(b1?.keywords)
      ? b1.keywords
      : config.customer_greeting?.order_trigger_keywords || ["1", "pesan", "order", "beli"];
    const isB1Match =
      cleanInput === "1" ||
      b1Keywords.some((kw) => {
        const cleanKw = String(kw).toLowerCase().trim();
        if (!cleanKw) return false;
        return cleanInput === cleanKw || new RegExp(`\\b${cleanKw}\\b`, "i").test(cleanInput);
      });

    if (isB1Match) {
      const b1Edge = graph.edges.find(
        (e) =>
          e.source === routerId &&
          (e.sourceHandle === "branch_1" ||
           e.sourceHandle?.toLowerCase().includes("branch_1") ||
           e.sourceHandle?.toLowerCase().includes("order") ||
           e.sourceHandle?.toLowerCase().includes("pesan"))
      );
      if (b1Edge) {
        activeEdges.push(b1Edge.id);
        visited.push(b1Edge.target);
      } else {
        const fNode = graph.nodes.find((n) => n.type === "ORDER_FORM_PROCESSOR" || n.id === "node-form");
        if (fNode) visited.push(fNode.id);
      }

      const formNode =
        (b1Edge ? graph.nodes.find((n) => n.id === b1Edge.target) : null) ||
        graph.nodes.find((n) => n.type === "ORDER_FORM_PROCESSOR" || n.id === "node-form");

      const formText =
        extractNodeMessageText(formNode) ||
        config.order_form?.form_template_text ||
        "Silakan isi formulir pesanan.";

      replies.push(formText);
      actions.push({
        type: "SEND_MESSAGE",
        text: formText,
        trigger_type: "CUSTOMER_REPLY",
      });
      actions.push({
        type: "UPDATE_SESSION",
        nextState: "AWAITING_ORDER",
        retryCount: 0,
        nextRouterId: null,
      });
      log.push("Pelanggan memilih opsi 1 (Pesan). Mengirim formulir.");

      return {
        actions,
        nodeTrace: visited,
        activeEdgeIds: activeEdges,
        nextState: "AWAITING_ORDER",
        nextRouterId: null,
        log,
        replies,
      };
    }

    // 5c. Evaluasi Cabang 2 (Tanya / CS Handover)
    const b2 = branches?.find((b) => b.id === "branch_2");
    const b2Keywords = Array.isArray(b2?.keywords)
      ? b2.keywords
      : config.customer_greeting?.ask_trigger_keywords || ["2", "tanya", "konsultasi", "admin"];
    const isB2Match =
      cleanInput === "2" ||
      b2Keywords.some((kw) => {
        const cleanKw = String(kw).toLowerCase().trim();
        if (!cleanKw) return false;
        return cleanInput === cleanKw || new RegExp(`\\b${cleanKw}\\b`, "i").test(cleanInput);
      });

    if (isB2Match) {
      const b2Edge = graph.edges.find(
        (e) =>
          e.source === routerId &&
          (e.sourceHandle === "branch_2" ||
           e.sourceHandle?.toLowerCase().includes("branch_2") ||
           e.sourceHandle?.toLowerCase().includes("tanya") ||
           e.sourceHandle?.toLowerCase().includes("cs") ||
           e.sourceHandle?.toLowerCase().includes("handover"))
      );
      if (b2Edge) {
        activeEdges.push(b2Edge.id);
        visited.push(b2Edge.target);
      } else {
        const hNode = graph.nodes.find((n) => n.type === "CS_HANDOVER" || n.id === "node-handover");
        if (hNode) visited.push(hNode.id);
      }

      const handoverNode =
        (b2Edge ? graph.nodes.find((n) => n.id === b2Edge.target) : null) ||
        graph.nodes.find((n) => n.type === "CS_HANDOVER" || n.id === "node-handover");

      const handoverText =
        extractNodeMessageText(handoverNode) ||
        config.cs_handover?.handover_customer_text ||
        "Siap Kak! Pertanyaan sudah kami sampaikan ke Owner.";

      replies.push(handoverText);
      actions.push({
        type: "SEND_MESSAGE",
        text: handoverText,
        trigger_type: "CUSTOMER_REPLY",
      });
      actions.push({
        type: "CS_HANDOVER",
        customerPhone: ctx.customerPhone || sampleVars.customer_phone,
        lastMessage: input.text,
      });
      actions.push({
        type: "UPDATE_SESSION",
        nextState: "PAUSED_FOR_OWNER",
        pausedAt: new Date(),
        retryCount: 0,
        nextRouterId: null,
      });

      return {
        actions,
        nodeTrace: visited,
        activeEdgeIds: activeEdges,
        nextState: "PAUSED_FOR_OWNER",
        nextRouterId: null,
        log,
        replies,
      };
    }

    // 5d. Input Tidak Dikenal (Aturan 3-Strike Rule & Fallback)
    const currentRetries = (ctx.retryCount || 0) + 1;

    if (currentRetries < 3) {
      // Kesalahan ke-1 dan ke-2
      const fallbackEdge = graph.edges.find(
        (e) =>
          e.source === routerId &&
          (e.sourceHandle === "branch_fallback" ||
           e.sourceHandle === "fallback" ||
           e.sourceHandle?.toLowerCase().includes("fallback"))
      );

      let nextRouterIdAfterFallback: string | undefined = routerId;
      if (fallbackEdge) {
        activeEdges.push(fallbackEdge.id);
        visited.push(fallbackEdge.target);
        const fallbackTargetNode = graph.nodes.find((n) => n.id === fallbackEdge.target);
        if (fallbackTargetNode) {
          const downstream = findDownstreamRouter(fallbackTargetNode.id, graph);
          if (downstream) {
            nextRouterIdAfterFallback = downstream.id;
          }
        }
      }
      const routerFallbackText = (routerData.fallback_reply_text as string)?.trim();
      const baseFallback =
        routerFallbackText ||
        "Mohon maaf Kak, pilihan belum sesuai format 🙏\nSilakan balas dengan mengetik angka 1, 2, atau 3 sesuai menu ya Kak.";
      const fallbackMsg = `${baseFallback} (Kesempatan ${currentRetries}/3)`;
      replies.push(fallbackMsg);
      actions.push({
        type: "SEND_MESSAGE",
        text: fallbackMsg,
        trigger_type: "CUSTOMER_REPLY",
      });
      actions.push({
        type: "UPDATE_SESSION",
        nextState: "AWAITING_CHOICE",
        retryCount: currentRetries,
        nextRouterId: nextRouterIdAfterFallback,
      });
      log.push(`Input tidak cocok (kesalahan ${currentRetries}/3). Mengirimkan pengingat format.`);

      return {
        actions,
        nodeTrace: visited,
        activeEdgeIds: activeEdges,
        nextState: "AWAITING_CHOICE",
        nextRouterId: nextRouterIdAfterFallback,
        log,
        replies,
      };
    } else {
      // Kesalahan ke-3: Auto-Handover ke Minri (Owner)
      const transitionMsg =
        "Mohon maaf Kak, tampaknya pilihan belum sesuai 🙏\nAgar lebih mudah, chat Kakak kami teruskan langsung ke Minri (Admin Berseri) ya. Bot kami jeda sejenak, mohon ditunggu sebentar ya Kak! ☕🌸";
      const ownerAlertMsg = `🔔 *Pemberitahuan: Bantuan Pelanggan* 🌸\n\nAda pelanggan yang salah memasukkan pilihan menu sebanyak 3x:\n• Nomor: ${ctx.customerPhone || sampleVars.customer_phone || "Pelanggan"}\n• Pesan Terakhir: "${(input.text || "").slice(0, 300)}"\n\nBot telah otomatis dijeda untuk nomor ini agar Minri bisa membantu secara langsung di WhatsApp.`;

      replies.push(transitionMsg);
      replies.push(ownerAlertMsg);

      actions.push({
        type: "SEND_MESSAGE",
        text: transitionMsg,
        trigger_type: "CUSTOMER_REPLY",
      });
      actions.push({
        type: "SEND_MESSAGE",
        text: ownerAlertMsg,
        trigger_type: "OWNER_DIGEST",
      });
      actions.push({
        type: "UPDATE_SESSION",
        nextState: "PAUSED_FOR_OWNER",
        pausedAt: new Date(),
        retryCount: 0,
        nextRouterId: null,
      });
      log.push("Input tidak cocok 3x berturut-turut. Mengaktifkan jeda dan meneruskan ke Minri.");

      return {
        actions,
        nodeTrace: visited,
        activeEdgeIds: activeEdges,
        nextState: "PAUSED_FOR_OWNER",
        nextRouterId: null,
        log,
        replies,
      };
    }

  }

  // 6. Default AWAITING_ORDER tanpa format lengkap
  const formNode = graph.nodes.find((n) => n.type === "ORDER_FORM_PROCESSOR" || n.id === "node-form");
  if (formNode) visited.push(formNode.id);

  const formText =
    extractNodeMessageText(formNode) ||
    config.order_form?.form_template_text ||
    "Silakan lengkapi formulir pesanan.";

  replies.push(formText);
  actions.push({
    type: "SEND_MESSAGE",
    text: formText,
    trigger_type: "CUSTOMER_REPLY",
  });
  actions.push({
    type: "UPDATE_SESSION",
    nextState: "AWAITING_ORDER",
  });

  return {
    actions,
    nodeTrace: visited,
    activeEdgeIds: activeEdges,
    nextState: "AWAITING_ORDER",
    log,
    replies,
  };
}
