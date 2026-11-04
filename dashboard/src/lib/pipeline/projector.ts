import { FLORIST_DECOR_PRESET } from "./presets";
import type {
  PipelineGraph,
  PipelineConfigData,
  OrderFormField,
} from "./schema";

/**
 * Proyeksi murni untuk menurunkan 6 kontainer inti dari graf visual (Single Source of Truth).
 * Graf visual adalah satu-satunya sumber kebenaran (SSOT); kontainer inti diturunkan
 * secara dinamis saat dibaca oleh runtime (inbound/accept, customer/handle).
 */
export function projectCoreConfig(
  graph: PipelineGraph,
  baseConfig: PipelineConfigData = FLORIST_DECOR_PRESET
): PipelineConfigData {
  const projected: PipelineConfigData = JSON.parse(JSON.stringify(baseConfig));
  projected.graph = graph;

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  // 1. Identifikasi root greeting node yang terhubung dari TRIGGER_INBOUND via out_customer
  const triggerNode =
    nodes.find((n) => n.type === "TRIGGER_INBOUND" || n.id === "node-trigger") ||
    nodes[0];

  const greetingEdge = edges.find(
    (e) =>
      (e.source === triggerNode?.id || e.source === "node-trigger") &&
      (e.sourceHandle === "out_customer" || e.sourceHandle === "Pelanggan Baru" || !e.sourceHandle)
  );

  const rootGreetingNode = greetingEdge
    ? nodes.find((n) => n.id === greetingEdge.target)
    : nodes.find((n) => n.id === "node-greeting");

  // Proyeksi sapaan akar ke customer_greeting
  if (rootGreetingNode && rootGreetingNode.data) {
    const rawGreeting =
      rootGreetingNode.data.greeting_text || rootGreetingNode.data.message_text;
    if (typeof rawGreeting === "string" && rawGreeting.trim().length > 0) {
      projected.customer_greeting.greeting_text = rawGreeting.trim();
    }
    if (typeof rootGreetingNode.data.enabled === "boolean") {
      projected.customer_greeting.enabled = rootGreetingNode.data.enabled;
    }
  }

  for (const node of nodes) {
    const data = (node.data as Record<string, unknown>) || {};

    switch (node.type) {
      case "TRIGGER_INBOUND": {
        projected.inbound_gate = {
          ...projected.inbound_gate,
          enabled: typeof data.enabled === "boolean" ? data.enabled : projected.inbound_gate.enabled,
          allow_unregistered_customers:
            typeof data.allow_unregistered_customers === "boolean"
              ? data.allow_unregistered_customers
              : projected.inbound_gate.allow_unregistered_customers,
          ignore_groups:
            typeof data.ignore_groups === "boolean"
              ? data.ignore_groups
              : projected.inbound_gate.ignore_groups,
          rate_limit_per_minute:
            typeof data.rate_limit_per_minute === "number"
              ? data.rate_limit_per_minute
              : projected.inbound_gate.rate_limit_per_minute,
          mute_bot_on_active_order:
            typeof data.mute_bot_on_active_order === "boolean"
              ? data.mute_bot_on_active_order
              : projected.inbound_gate.mute_bot_on_active_order,
          mute_max_hours:
            typeof data.mute_max_hours === "number"
              ? data.mute_max_hours
              : projected.inbound_gate.mute_max_hours,
        };
        break;
      }

      case "MESSAGE_MENU": {
        // HANYA sinkron jika ini adalah root greeting node dari trigger
        if (node.id === rootGreetingNode?.id) {
          projected.customer_greeting = {
            ...projected.customer_greeting,
            enabled: typeof data.enabled === "boolean" ? data.enabled : projected.customer_greeting.enabled,
            greeting_text:
              typeof data.message_text === "string" && data.message_text.trim().length > 0
                ? data.message_text.trim()
                : typeof data.greeting_text === "string" && data.greeting_text.trim().length > 0
                  ? data.greeting_text.trim()
                  : projected.customer_greeting.greeting_text,
          };
        }
        break;
      }

      case "CONDITION_ROUTER": {
        const branches = Array.isArray(data.branches)
          ? (data.branches as Array<{ id: string; label: string; keywords: string[] }>)
          : null;
        let b1 = Array.isArray(data.branch_1_keywords) ? (data.branch_1_keywords as string[]) : null;
        let b2 = Array.isArray(data.branch_2_keywords) ? (data.branch_2_keywords as string[]) : null;

        if (branches) {
          const foundB1 = branches.find((b) => b.id === "branch_1");
          if (foundB1) b1 = foundB1.keywords;
          const foundB2 = branches.find((b) => b.id === "branch_2");
          if (foundB2) b2 = foundB2.keywords;
        }

        projected.customer_greeting = {
          ...projected.customer_greeting,
          order_trigger_keywords: b1 || projected.customer_greeting.order_trigger_keywords,
          ask_trigger_keywords: b2 || projected.customer_greeting.ask_trigger_keywords,
          unrecognized_choice_text:
            typeof data.fallback_reply_text === "string"
              ? data.fallback_reply_text
              : projected.customer_greeting.unrecognized_choice_text,
        };
        break;
      }

      case "ORDER_FORM_PROCESSOR": {
        projected.order_form = {
          ...projected.order_form,
          enabled: typeof data.enabled === "boolean" ? data.enabled : projected.order_form.enabled,
          form_template_text:
            typeof data.form_template_text === "string"
              ? data.form_template_text
              : projected.order_form.form_template_text,
          required_fields: Array.isArray(data.required_fields)
            ? (data.required_fields as OrderFormField[])
            : projected.order_form.required_fields,
          missing_fields_prefix:
            typeof data.missing_fields_prefix === "string"
              ? data.missing_fields_prefix
              : projected.order_form.missing_fields_prefix,
          enable_llm_fallback:
            typeof data.enable_llm_fallback === "boolean"
              ? data.enable_llm_fallback
              : projected.order_form.enable_llm_fallback,
        };
        break;
      }

      case "CS_HANDOVER": {
        projected.cs_handover = {
          ...projected.cs_handover,
          enabled: typeof data.enabled === "boolean" ? data.enabled : projected.cs_handover.enabled,
          handover_customer_text:
            typeof data.handover_customer_text === "string"
              ? data.handover_customer_text
              : projected.cs_handover.handover_customer_text,
          pause_ttl_hours:
            typeof data.pause_ttl_hours === "number"
              ? data.pause_ttl_hours
              : projected.cs_handover.pause_ttl_hours,
          notify_owner:
            typeof data.notify_owner === "boolean"
              ? data.notify_owner
              : projected.cs_handover.notify_owner,
          owner_handover_alert_template:
            typeof data.owner_handover_alert_template === "string"
              ? data.owner_handover_alert_template
              : projected.cs_handover.owner_handover_alert_template,
        };
        break;
      }

      case "ORDER_FULFILLMENT": {
        projected.order_confirmation = {
          ...projected.order_confirmation,
          enabled: typeof data.enabled === "boolean" ? data.enabled : projected.order_confirmation.enabled,
          customer_confirmation_template:
            typeof data.customer_confirmation_template === "string"
              ? data.customer_confirmation_template
              : projected.order_confirmation.customer_confirmation_template,
          notify_owner_on_new_order:
            typeof data.notify_owner_on_new_order === "boolean"
              ? data.notify_owner_on_new_order
              : projected.order_confirmation.notify_owner_on_new_order,
          owner_new_order_alert_template:
            typeof data.owner_new_order_alert_template === "string"
              ? data.owner_new_order_alert_template
              : projected.order_confirmation.owner_new_order_alert_template,
        };
        break;
      }

      case "OWNER_AI_AGENT": {
        projected.owner_assistant = {
          ...projected.owner_assistant,
          enabled: typeof data.enabled === "boolean" ? data.enabled : projected.owner_assistant.enabled,
          enable_todo_tools:
            typeof data.enable_todo_tools === "boolean"
              ? data.enable_todo_tools
              : projected.owner_assistant.enable_todo_tools,
          enable_order_tools:
            typeof data.enable_order_tools === "boolean"
              ? data.enable_order_tools
              : projected.owner_assistant.enable_order_tools,
          enable_voice_note_stt:
            typeof data.enable_voice_note_stt === "boolean"
              ? data.enable_voice_note_stt
              : projected.owner_assistant.enable_voice_note_stt,
        };
        break;
      }

      default:
        break;
    }
  }

  return projected;
}
