import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { OUTBOUND_TRIGGERS, type Trigger } from "@/lib/waha/triggers";

const WORKFLOWS_DIR = path.resolve(__dirname, "../../../n8n-engine/workflows");
const SCHEDULER_PATH = path.join(WORKFLOWS_DIR, "botseri-scheduler.json");
const INBOUND_PATH = path.join(WORKFLOWS_DIR, "botseri-inbound-agent.json");

function extractTriggerTypesFromWorkflow(workflowJson: Record<string, unknown>): string[] {
  const triggers: string[] = [];
  const nodes = Array.isArray(workflowJson.nodes) ? workflowJson.nodes : [];

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const nodeObj = node as Record<string, unknown>;
    const params = nodeObj.parameters as Record<string, unknown> | undefined;
    const url = String(params?.url || "");

    if (
      url.includes("/api/internal/waha/send") ||
      nodeObj.name === "Kirim WhatsApp" ||
      nodeObj.name === "Kirim WhatsApp Alarm"
    ) {
      const jsonBody = String(params?.jsonBody || "");

      // 1. Ekstrak literal: trigger_type: '...' atau "..."
      const literalRegex = /trigger_type:\s*['"]([A-Z_]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = literalRegex.exec(jsonBody)) !== null) {
        triggers.push(m[1]);
      }

      // 2. Ekstrak ternary: ('PAIRING' : 'CHAT_MASUK')
      const ternaryRegex = /['"]([A-Z_]+)['"]\s*:\s*['"]([A-Z_]+)['"]/g;
      while ((m = ternaryRegex.exec(jsonBody)) !== null) {
        triggers.push(m[1], m[2]);
      }
    }

    // Periksa node format waha code jika ada
    if (nodeObj.type === "n8n-nodes-base.code") {
      const jsCode = String(params?.jsCode || "");
      const codeRegex = /trigger_type:\s*[^'"]*['"]([A-Z_]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = codeRegex.exec(jsCode)) !== null) {
        triggers.push(m[1]);
      }
    }
  }

  return Array.from(new Set(triggers));
}

describe("Workflow Outbound Trigger Contracts", () => {
  it("botseri-scheduler.json: job alarm uses TASK_ALARM and all triggers belong to OUTBOUND_TRIGGERS", () => {
    const schedulerRaw = fs.readFileSync(SCHEDULER_PATH, "utf8");
    const scheduler = JSON.parse(schedulerRaw);

    const alarmNode = (scheduler.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === "http-send-alarm" || n.name === "Kirim WhatsApp Alarm"
    );
    expect(alarmNode).toBeDefined();

    const jsonBody = String((alarmNode?.parameters as Record<string, unknown>)?.jsonBody || "");
    // Contract: job alarm WAJIB mengirim trigger_type: 'TASK_ALARM', BUKAN 'WORK_HOURS_REMINDER'
    expect(jsonBody).toContain("trigger_type: 'TASK_ALARM'");
    expect(jsonBody).not.toContain("trigger_type: 'WORK_HOURS_REMINDER'");

    const extracted = extractTriggerTypesFromWorkflow(scheduler);
    for (const trig of extracted) {
      expect(OUTBOUND_TRIGGERS).toContain(trig as Trigger);
    }
  });

  it("botseri-inbound-agent.json: all triggers sent to waha/send belong to OUTBOUND_TRIGGERS", () => {
    const inboundRaw = fs.readFileSync(INBOUND_PATH, "utf8");
    const inbound = JSON.parse(inboundRaw);

    const extracted = extractTriggerTypesFromWorkflow(inbound);
    expect(extracted.length).toBeGreaterThan(0);
    for (const trig of extracted) {
      expect(OUTBOUND_TRIGGERS).toContain(trig as Trigger);
    }
  });

  it("negative fixture: rejects unknown or unauthorized trigger_type", () => {
    const invalidTrigger = "INVALID_TRIGGER_TYPE";
    expect(OUTBOUND_TRIGGERS.includes(invalidTrigger as unknown as Trigger)).toBe(false);
  });
});
