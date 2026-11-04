import type { CustomerSessionState } from "@prisma/client";
import type { PipelineConfigData } from "./schema";
import { runPipelineStep } from "./engine";

export interface SimulationResult {
  visited_node_ids: string[];
  active_edge_ids: string[];
  replies: string[];
  next_state: CustomerSessionState;
  log: string[];
  active_router_id?: string;
}

/**
 * Simulator visual kanvas Studio Alur Kerja (S10 §4).
 * Menjalankan engine pipeline terpadu dalam mode dryRun = true
 * tanpa menimbulkan efek samping ke database atau WhatsApp.
 */
export function simulatePipelineExecution(
  config: PipelineConfigData,
  inputMessage: string,
  currentState: CustomerSessionState = "INIT",
  senderRole: "CUSTOMER" | "OWNER" = "CUSTOMER",
  currentRouterId?: string,
): SimulationResult {
  const result = runPipelineStep(
    {
      config,
      sessionState: currentState,
      currentRouterId,
      senderRole,
    },
    {
      text: inputMessage,
    },
    { dryRun: true }
  );

  return {
    visited_node_ids: result.nodeTrace,
    active_edge_ids: result.activeEdgeIds,
    replies: result.replies,
    next_state: result.nextState,
    log: result.log,
    active_router_id: result.nextRouterId || undefined,
  };
}
