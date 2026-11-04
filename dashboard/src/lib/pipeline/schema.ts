import { z } from "zod";

export const InboundGateSchema = z.object({
  enabled: z.boolean().default(true),
  allow_unregistered_customers: z.boolean().default(true),
  ignore_groups: z.boolean().default(true),
  rate_limit_per_minute: z.number().int().min(3).max(100).default(20),
  mute_bot_on_active_order: z.boolean().default(true),
});

export const CustomerGreetingSchema = z.object({
  enabled: z.boolean().default(true),
  greeting_text: z.string().min(10).max(2000),
  order_trigger_keywords: z.array(z.string()).default(["1", "pesan", "order", "beli"]),
  ask_trigger_keywords: z.array(z.string()).default(["2", "tanya", "konsul", "konsultasi", "nanya", "info"]),
  unrecognized_choice_text: z.string().min(10).max(1000),
});

export const RouterBranchSchema = z.object({
  id: z.string(),
  label: z.string(),
  keywords: z.array(z.string()),
});

export const ConditionRouterDataSchema = z.object({
  label: z.string().optional(),
  branches: z.array(RouterBranchSchema).default([
    { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan", "order", "beli"] },
    { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya", "konsultasi", "info"] },
    { id: "branch_3", label: "Cabang 3 (Kustom)", keywords: [] },
  ]),
  fallback_reply_text: z.string().optional(),
});

export const OrderFormFieldEnum = z.enum([
  "nama_pemesan",
  "jenis_pesanan",
  "tanggal_acara",
  "jam_pengiriman",
  "alamat",
  "request_khusus",
]);

export const OrderFormSchema = z.object({
  enabled: z.boolean().default(true),
  form_template_text: z.string().min(10).max(2000),
  required_fields: z.array(OrderFormFieldEnum).default([
    "nama_pemesan",
    "jenis_pesanan",
    "tanggal_acara",
    "alamat",
  ]),
  missing_fields_prefix: z.string().default(
    "Terima kasih Kak! Namun beberapa data pesanan berikut masih belum lengkap:"
  ),
  enable_llm_fallback: z.boolean().default(true),
});

export const CsHandoverSchema = z.object({
  enabled: z.boolean().default(true),
  handover_customer_text: z.string().min(10).max(1500),
  pause_ttl_hours: z.number().int().min(1).max(168).default(24),
  notify_owner: z.boolean().default(true),
  owner_handover_alert_template: z.string().min(10).max(1500),
});

export const OrderConfirmationSchema = z.object({
  enabled: z.boolean().default(true),
  customer_confirmation_template: z.string().min(10).max(2000),
  notify_owner_on_new_order: z.boolean().default(true),
  owner_new_order_alert_template: z.string().min(10).max(2000),
});

export const OwnerAssistantSchema = z.object({
  enabled: z.boolean().default(true),
  enable_todo_tools: z.boolean().default(true),
  enable_order_tools: z.boolean().default(true),
  enable_voice_note_stt: z.boolean().default(true),
});

export const PipelineNodeTypeEnum = z.enum([
  "TRIGGER_INBOUND",
  "MESSAGE_MENU",
  "CONDITION_ROUTER",
  "ORDER_FORM_PROCESSOR",
  "CS_HANDOVER",
  "ORDER_FULFILLMENT",
  "CUSTOM_WA_REPLY",
  "OWNER_AI_AGENT",
]);

export const PipelineGraphNodeSchema = z.object({
  id: z.string().min(1),
  type: PipelineNodeTypeEnum,
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()),
});

export const PipelineGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional().nullable(),
  targetHandle: z.string().optional().nullable(),
  label: z.string().optional(),
});

export const PipelineGraphSchema = z.object({
  nodes: z.array(PipelineGraphNodeSchema).default([]),
  edges: z.array(PipelineGraphEdgeSchema).default([]),
});

export const PipelineConfigSchema = z.object({
  inbound_gate: InboundGateSchema,
  customer_greeting: CustomerGreetingSchema,
  order_form: OrderFormSchema,
  cs_handover: CsHandoverSchema,
  order_confirmation: OrderConfirmationSchema,
  owner_assistant: OwnerAssistantSchema,
  graph: PipelineGraphSchema.optional().default({ nodes: [], edges: [] }),
});

export type PipelineConfigData = z.infer<typeof PipelineConfigSchema>;
export type InboundGateConfig = z.infer<typeof InboundGateSchema>;
export type CustomerGreetingConfig = z.infer<typeof CustomerGreetingSchema>;
export type OrderFormConfig = z.infer<typeof OrderFormSchema>;
export type CsHandoverConfig = z.infer<typeof CsHandoverSchema>;
export type OrderConfirmationConfig = z.infer<typeof OrderConfirmationSchema>;
export type OwnerAssistantConfig = z.infer<typeof OwnerAssistantSchema>;
export type OrderFormField = z.infer<typeof OrderFormFieldEnum>;
export type RouterBranch = z.infer<typeof RouterBranchSchema>;
export type ConditionRouterData = z.infer<typeof ConditionRouterDataSchema>;
export type PipelineNodeType = z.infer<typeof PipelineNodeTypeEnum>;
export type PipelineGraphNode = z.infer<typeof PipelineGraphNodeSchema>;
export type PipelineGraphEdge = z.infer<typeof PipelineGraphEdgeSchema>;
export type PipelineGraph = z.infer<typeof PipelineGraphSchema>;
