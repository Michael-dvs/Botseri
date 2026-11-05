#!/usr/bin/env tsx
/**
 * Skrip pengujian reproduksi deterministik E2E percakapan pelanggan (S15 Forensik).
 * Menguji skenario berurutan: Sapaan awal -> Pilihan 1, 2, 3, dan 4.
 *
 * Penggunaan:
 *   npx tsx scripts/test-e2e-incoming.ts
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

let PrismaClientConstructor: typeof PrismaClientType;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PrismaClientConstructor = require("@prisma/client").PrismaClient;
} catch {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PrismaClientConstructor = require(path.resolve(__dirname, "../dashboard/node_modules/@prisma/client")).PrismaClient;
}

const prisma = new PrismaClientConstructor();

function getEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key]!;
  try {
    const envPath = path.resolve(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^${key}=["\x27]?([^"\x27\r\n]+)["\x27]?`, "m"));
      if (match) return match[1].trim();
    }
  } catch {
    // fallback
  }
  return fallback;
}

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://127.0.0.1:3000";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/wa-incoming";
const INTERNAL_TOKEN = getEnv("INTERNAL_API_TOKEN", "test-token");
const SIM_PHONE = "+6289900112233";
const SIM_CHAT_ID = "6289900112233@c.us";
const SIM_LID = "160275344937145@lid";

interface StepExpectation {
  name: string;
  senderId: string;
  remoteJidAlt?: string;
  text: string;
  expectedStateAfter: string;
  expectedReplySnippet: string;
}

async function cleanSimSession(phone: string) {
  try {
    const rawDigits = phone.replace(/\D/g, "");
    execSync(
      `docker compose exec -T botseri-db psql -U botseri -d botseri -c "DELETE FROM customer_sessions WHERE phone_e164 LIKE '%${rawDigits}%';"`,
      { stdio: "ignore" }
    );
  } catch {
    try {
      await prisma.customerSession.deleteMany({
        where: {
          OR: [
            { phone_e164: phone },
            { phone_e164: phone.replace(/^\+/, "") },
          ],
        },
      });
    } catch {
      // ignore
    }
  }
}

async function runStep(step: StepExpectation, seq: number): Promise<{ pass: boolean; actualReply: string; actualState: string; reason?: string }> {
  const msgId = `sim-e2e-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
  const nowTs = Math.floor(Date.now() / 1000);

  // 1. Uji endpoint inbound/accept
  const acceptPayload = {
    wa_message_id: msgId,
    chat_id: step.senderId,
    from: step.senderId,
    remote_jid_alt: step.remoteJidAlt || null,
    body: step.text,
    from_me: false,
    received_at: new Date().toISOString(),
  };

  const acceptRes = await fetch(`${DASHBOARD_URL}/api/internal/inbound/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INTERNAL_TOKEN}`,
    },
    body: JSON.stringify(acceptPayload),
  });

  if (!acceptRes.ok) {
    return {
      pass: false,
      actualReply: "",
      actualState: "ACCEPT_FAILED",
      reason: `Accept mengembalikan HTTP ${acceptRes.status}`,
    };
  }

  const acceptData = await acceptRes.json();
  if (!acceptData.accept) {
    return {
      pass: false,
      actualReply: "",
      actualState: "ACCEPT_REJECTED",
      reason: `Accept menolak pesan: ${acceptData.reason || acceptData.error}`,
    };
  }

  // 2. Uji endpoint customer/handle (mengikuti alur yang diteruskan oleh n8n)
  const custHandlePayload = {
    customer_phone: acceptData.customer_phone || SIM_PHONE,
    message_text: acceptData.message_text || acceptData.body || step.text,
    message_id: msgId,
    from_me: false,
    intent: acceptData.intent || null,
  };

  const handleRes = await fetch(`${DASHBOARD_URL}/api/internal/customer/handle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INTERNAL_TOKEN}`,
    },
    body: JSON.stringify(custHandlePayload),
  });

  if (!handleRes.ok) {
    return {
      pass: false,
      actualReply: "",
      actualState: "HANDLE_FAILED",
      reason: `Customer handle mengembalikan HTTP ${handleRes.status}`,
    };
  }

  const handleData = await handleRes.json();
  const replies = handleData.replies || [];
  const firstReply = replies[0]?.text || replies[0]?.body || "";
  const actualState = handleData.state_after || "";

  if (replies.length === 0) {
    return {
      pass: false,
      actualReply: "SILENT_DROP_EMPTY_REPLIES",
      actualState,
      reason: "Customer handle mengembalikan array replies kosong (silent drop).",
    };
  }

  if (actualState !== step.expectedStateAfter) {
    return {
      pass: false,
      actualReply: firstReply,
      actualState,
      reason: `State tidak cocok: ekspektasi '${step.expectedStateAfter}', aktual '${actualState}'`,
    };
  }

  if (!firstReply.toLowerCase().includes(step.expectedReplySnippet.toLowerCase())) {
    return {
      pass: false,
      actualReply: firstReply,
      actualState,
      reason: `Teks balasan tidak memuat '${step.expectedReplySnippet}'`,
    };
  }

  return {
    pass: true,
    actualReply: firstReply,
    actualState,
  };
}

async function main() {
  console.log("=== Memulai Pengujian Reproduksi Deterministik Alur Pelanggan ===\n");
  console.log(`Target Dashboard: ${DASHBOARD_URL}`);
  console.log(`Target Phone    : ${SIM_PHONE}\n`);

  let allPassed = true;
  const resultsTable: Array<{ langkah: string; input: string; pengirim: string; state: string; status: string; catatan: string }> = [];

  // Skenario 1: Percakapan Berurutan via format @c.us (Sapaan -> Pilihan 1 Order)
  await cleanSimSession(SIM_PHONE);
  const stepsStandard: StepExpectation[] = [
    {
      name: "1. Sapaan Awal (@c.us)",
      senderId: SIM_CHAT_ID,
      text: "halo berseri",
      expectedStateAfter: "AWAITING_CHOICE",
      expectedReplySnippet: "Berseri",
    },
    {
      name: "2. Input '1' (Order)",
      senderId: SIM_CHAT_ID,
      text: "1",
      expectedStateAfter: "AWAITING_ORDER",
      expectedReplySnippet: "FORMAT PESANAN BERSERI",
    },
  ];

  for (let i = 0; i < stepsStandard.length; i++) {
    const res = await runStep(stepsStandard[i], i + 1);
    if (!res.pass) allPassed = false;
    resultsTable.push({
      langkah: stepsStandard[i].name,
      input: stepsStandard[i].text,
      pengirim: "@c.us",
      state: res.actualState,
      status: res.pass ? "PASS" : "FAIL",
      catatan: res.reason || "Lulus sesuai ekspektasi",
    });
  }

  // Skenario 2: Percakapan Berurutan via format @lid (Sapaan -> Pilihan 3 Katalog -> Pilihan 1 Order)
  await cleanSimSession(SIM_PHONE);
  const stepsLid: StepExpectation[] = [
    {
      name: "3. Sapaan Awal (@lid)",
      senderId: SIM_LID,
      remoteJidAlt: `${SIM_PHONE.replace(/\D/g, "")}@s.whatsapp.net`,
      text: "halo berseri",
      expectedStateAfter: "AWAITING_CHOICE",
      expectedReplySnippet: "Berseri",
    },
    {
      name: "4. Input '3' (Katalog via @lid)",
      senderId: SIM_LID,
      remoteJidAlt: `${SIM_PHONE.replace(/\D/g, "")}@s.whatsapp.net`,
      text: "3",
      expectedStateAfter: "AWAITING_CHOICE",
      expectedReplySnippet: "katalog",
    },
    {
      name: "5. Input '1' Pasca-Katalog",
      senderId: SIM_LID,
      remoteJidAlt: `${SIM_PHONE.replace(/\D/g, "")}@s.whatsapp.net`,
      text: "1",
      expectedStateAfter: "AWAITING_ORDER",
      expectedReplySnippet: "FORMAT PESANAN BERSERI",
    },
  ];

  for (let i = 0; i < stepsLid.length; i++) {
    const res = await runStep(stepsLid[i], i + 10);
    if (!res.pass) allPassed = false;
    resultsTable.push({
      langkah: stepsLid[i].name,
      input: stepsLid[i].text,
      pengirim: "@lid",
      state: res.actualState,
      status: res.pass ? "PASS" : "FAIL",
      catatan: res.reason || "Lulus sesuai ekspektasi",
    });
  }

  // Skenario 3: Input Tidak Valid '4' (Pilihan Di Luar Menu)
  await cleanSimSession(SIM_PHONE);
  const stepFallback: StepExpectation = {
    name: "6. Input '4' (Fallback Format)",
    senderId: SIM_CHAT_ID,
    text: "4",
    expectedStateAfter: "AWAITING_CHOICE",
    expectedReplySnippet: "belum menangkap",
  };
  // Sapaan dulu
  await runStep({
    name: "Setup Sapaan",
    senderId: SIM_CHAT_ID,
    text: "halo berseri",
    expectedStateAfter: "AWAITING_CHOICE",
    expectedReplySnippet: "Berseri",
  }, 99);

  const resFallback = await runStep(stepFallback, 100);
  if (!resFallback.pass) allPassed = false;
  resultsTable.push({
    langkah: stepFallback.name,
    input: stepFallback.text,
    pengirim: "@c.us",
    state: resFallback.actualState,
    status: resFallback.pass ? "PASS" : "FAIL",
    catatan: resFallback.reason || "Lulus sesuai ekspektasi",
  });

  // Tampilkan tabel hasil
  console.log("| Langkah | Input | Format | State Akhir | Status | Catatan |");
  console.log("|---|---|---|---|---|---|");
  for (const r of resultsTable) {
    console.log(`| ${r.langkah.padEnd(28)} | ${r.input.padEnd(5)} | ${r.pengirim.padEnd(6)} | ${r.state.padEnd(16)} | ${r.status.padEnd(6)} | ${r.catatan} |`);
  }

  console.log(`\nHASIL AKHIR: ${allPassed ? "SELURUH PENGUJIAN LULUS (PASS)" : "DITEMUKAN KEGAGALAN (FAIL)"}`);

  await cleanSimSession(SIM_PHONE);
  await prisma.$disconnect();

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error test-e2e-incoming:", err);
  process.exit(1);
});
