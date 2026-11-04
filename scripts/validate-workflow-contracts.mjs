#!/usr/bin/env node

/**
 * Validasi kontrak workflow n8n terhadap enum OUTBOUND_TRIGGERS (INV-13).
 * Memeriksa seluruh node pengirim WAHA di dalam workflow JSON.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TRIGGERS_FILE = path.join(REPO_ROOT, "dashboard/src/lib/waha/triggers.ts");

function loadOutboundTriggers() {
  const content = fs.readFileSync(TRIGGERS_FILE, "utf8");
  const match = content.match(/export const OUTBOUND_TRIGGERS = \[\s*([\s\S]*?)\] as const;/);
  if (!match) {
    throw new Error("Gagal membaca OUTBOUND_TRIGGERS dari triggers.ts");
  }
  return match[1]
    .split(",")
    .map((s) => s.replace(/['"\s]/g, ""))
    .filter(Boolean);
}

export function validateWorkflowTriggers(workflowPath, allowedTriggers) {
  const raw = fs.readFileSync(workflowPath, "utf8");
  const workflow = JSON.parse(raw);
  const violations = [];

  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    const params = node.parameters || {};
    const url = String(params.url || "");
    const nodeName = String(node.name || "");

    if (url.includes("/api/internal/waha/send") || nodeName.includes("Kirim WhatsApp")) {
      const jsonBody = String(params.jsonBody || "");

      // 1. Ekstrak literal: trigger_type: '...' atau "..."
      const literalMatches = [...jsonBody.matchAll(/trigger_type:\s*['"]([A-Z_]+)['"]/g)];
      for (const m of literalMatches) {
        const val = m[1];
        if (!allowedTriggers.includes(val)) {
          violations.push({
            node: node.id || nodeName,
            trigger: val,
            reason: `trigger_type '${val}' tidak terdaftar di OUTBOUND_TRIGGERS`,
          });
        }
      }

      // 2. Ekstrak ekspresi ternary literal: ('PAIRING' : 'CHAT_MASUK')
      const ternaryMatches = [...jsonBody.matchAll(/['"]([A-Z_]+)['"]\s*:\s*['"]([A-Z_]+)['"]/g)];
      for (const m of ternaryMatches) {
        for (const val of [m[1], m[2]]) {
          if (val !== "TRUE" && val !== "FALSE" && !allowedTriggers.includes(val)) {
            violations.push({
              node: node.id || nodeName,
              trigger: val,
              reason: `trigger_type '${val}' dalam ekspresi ternary tidak terdaftar di OUTBOUND_TRIGGERS`,
            });
          }
        }
      }
    }

    if (node.type === "n8n-nodes-base.code") {
      const jsCode = String(params.jsCode || "");
      const matches = [...jsCode.matchAll(/trigger_type:\s*[^'"]*['"]([A-Z_]+)['"]/g)];
      for (const m of matches) {
        const val = m[1];
        if (!allowedTriggers.includes(val)) {
          violations.push({
            node: node.id || nodeName,
            trigger: val,
            reason: `trigger_type '${val}' di node Code tidak terdaftar di OUTBOUND_TRIGGERS`,
          });
        }
      }
    }
  }

  return violations;
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const allowed = loadOutboundTriggers();
  const targetFile = process.argv[2];

  if (targetFile === "--test-negative") {
    // Pengujian fixture negatif terisolasi
    const dummyWorkflow = {
      id: "dummy",
      name: "Dummy Negative Test",
      nodes: [
        {
          id: "node-1",
          name: "Kirim WhatsApp Ilegal",
          parameters: {
            url: "http://botseri-dashboard:3000/api/internal/waha/send",
            jsonBody: "={ JSON.stringify({ trigger_type: 'INVALID_UNKNOWN_TRIGGER' }) }",
          },
        },
      ],
    };
    const tmpPath = path.join(REPO_ROOT, "temp-negative-workflow.json");
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(dummyWorkflow), "utf8");
      const testViolations = validateWorkflowTriggers(tmpPath, allowed);
      if (testViolations.length === 0) {
        console.error("Fixture negatif GAGAL: trigger tak dikenal tidak tertangkap!");
        process.exit(1);
      }
      console.log("Fixture negatif SUKSES: trigger tak dikenal berhasil ditolak.");
      process.exit(0);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  if (!targetFile) {
    console.error("Gunakan: node validate-workflow-contracts.mjs <path-ke-workflow.json>");
    process.exit(1);
  }

  const violations = validateWorkflowTriggers(targetFile, allowed);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${targetFile}: INV-13: Node '${v.node}' - ${v.reason}`);
    }
    process.exit(1);
  }

  process.exit(0);
}
