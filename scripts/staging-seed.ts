#!/usr/bin/env tsx
/**
 * Skrip inisialisasi data uji lingkungan staging (S13 §2).
 * Wajib memvalidasi DATABASE_URL agar tidak pernah mengeksekusi pada basis data produksi.
 *
 * Penggunaan:
 *   DATABASE_URL=postgresql://.../botseri_staging npx tsx scripts/staging-seed.ts
 */

import path from "node:path";
import type { PrismaClient } from "@prisma/client";


const dbUrl = process.env.DATABASE_URL || "";

// Pengaman Kritis: Dilarang keras mengeksekusi pada database produksi
if (!dbUrl.toLowerCase().includes("staging")) {
  console.error("=================================================================");
  console.error("PERINGATAN KRITIS: DATABASE_URL tidak mengarah ke database staging!");
  console.error(`DATABASE_URL saat ini: ${dbUrl}`);
  console.error("Eksekusi seeding dibatalkan demi keamanan data produksi.");
  console.error("=================================================================");
  process.exit(1);
}

let PrismaClientConstructor: typeof PrismaClient;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PrismaClientConstructor = require("@prisma/client").PrismaClient;
} catch {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PrismaClientConstructor = require(path.resolve(__dirname, "../dashboard/node_modules/@prisma/client")).PrismaClient;
}

const prisma = new PrismaClientConstructor();

async function main() {
  console.log("[STAGING-SEED] Memulai inisialisasi data uji staging...");

  // 1. Inisialisasi Bot Settings
  await prisma.botSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      brand_name: "TEST-Berseri Florist",
      business_type: "Florist & Dekorasi",
      owner_name: "TEST-Owner",
      timezone: "Asia/Jakarta",
      bot_enabled: true,
      setup_completed: true,
      enable_orders: true,
      working_days: [1, 2, 3, 4, 5],
      work_hours_start: "08:00",
      work_hours_end: "17:00",
      early_brief_time: "07:00",
      brief_window_minutes: 60,
      reminder_max_per_day: 3,
      reminder_max_rank: 5,
      customer_data_retention_days: 365,
    },
    update: {
      brand_name: "TEST-Berseri Florist",
      owner_name: "TEST-Owner",
      bot_enabled: true,
      setup_completed: true,
    },
  });

  // 2. Inisialisasi Nomor Owner Uji (1 nomor dengan is_primary = true)
  await prisma.authorizedNumber.upsert({
    where: { phone_e164: "+6281299990001" },
    create: {
      phone_e164: "+6281299990001",
      chat_id: "6281299990001@c.us",
      is_owner: true,
      is_primary: true,
      label: "TEST-PrimaryOwner",
    },
    update: {
      is_owner: true,
      is_primary: true,
      label: "TEST-PrimaryOwner",
    },
  });

  // 3. Inisialisasi Nomor Pelanggan Uji (2 nomor)
  await prisma.customerSession.upsert({
    where: { phone_e164: "+6281299990002" },
    create: {
      phone_e164: "+6281299990002",
      customer_name: "TEST-Customer-A",
      state: "INIT",
      metadata: { seed_label: "TEST-A" },
    },
    update: {
      customer_name: "TEST-Customer-A",
      state: "INIT",
    },
  });

  await prisma.customerSession.upsert({
    where: { phone_e164: "+6281299990003" },
    create: {
      phone_e164: "+6281299990003",
      customer_name: "TEST-Customer-B",
      state: "INIT",
      metadata: { seed_label: "TEST-B" },
    },
    update: {
      customer_name: "TEST-Customer-B",
      state: "INIT",
    },
  });

  // 4. Inisialisasi Konfigurasi LLM Mock Uji
  await prisma.llmConfig.upsert({
    where: { id: "test-mock-llm-config" },
    create: {
      id: "test-mock-llm-config",
      provider: "OPENROUTER",
      model: "TEST-mock/gemini-flash",
      base_url: "http://127.0.0.1:3000/api/mock-llm",
      api_key_enc: "TEST-encrypted-key",
      temperature: 0.3,
      max_output_tokens: 2048,
      is_active: true,
      is_fallback: false,
    },
    update: {
      model: "TEST-mock/gemini-flash",
      is_active: true,
      is_fallback: false,
    },
  });

  // 5. Inisialisasi Visual Pipeline Preset Uji
  await prisma.pipelineConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: "TEST-Pipeline-Florist",
      preset_key: "FLORIST_DECOR",
      version: 1,
      config_json: {
        preset: "FLORIST_DECOR",
        name: "TEST-Pipeline",
        nodes: [
          { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
          { id: "node-ai", type: "OWNER_AI_AGENT", position: { x: 200, y: 0 }, data: {} },
        ],
        edges: [
          { id: "e1", source: "node-trigger", target: "node-ai" },
        ],
      },
    },
    update: {
      name: "TEST-Pipeline-Florist",
      version: 1,
    },
  });

  console.log("[STAGING-SEED] Sukses inisialisasi seluruh data uji terstandarisasi prefiks TEST-!");
}

main()
  .catch((e) => {
    console.error("[STAGING-SEED] Gagal inisialisasi:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
