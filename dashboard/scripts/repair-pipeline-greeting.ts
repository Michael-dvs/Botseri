#!/usr/bin/env tsx
/**
 * Skrip satu kali perbaikan greeting pipeline (S06).
 * Membaca graf aktif, mengambil teks sapaan asli dari node sapaan akar,
 * memastikan tidak terkontaminasi tautan drive/katalog, dan menyinkronkannya secara idempoten.
 *
 * Penggunaan:
 *   npx tsx scripts/repair-pipeline-greeting.ts [--dry-run] [--apply]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_GREETING =
  "Halo, selamat datang di *Berseri Florist & Decor*!\nSenang sekali Kakak menghubungi kami. Ada yang bisa kami bantu hari ini?\n\n1 *Langsung Pesan* (Buket Bunga / Dekorasi Acara)\n2 *Tanya-tanya / Konsultasi Dulu*\n\n_(Balas dengan angka *1* atau *2* ya Kak)_";

async function main() {
  const isApply = process.argv.includes("--apply");
  console.log(`[REPAIR-GREETING] Mode: ${isApply ? "APPLY (perubahan disimpan)" : "DRY-RUN (simulasi)"}`);

  const row = await prisma.pipelineConfig.findUnique({ where: { id: 1 } });
  if (!row) {
    console.log("[REPAIR-GREETING] Tidak ada baris pipelineConfig di database. Selesai.");
    return;
  }

  const config = row.config_json as Record<string, any>;
  const graph = config?.graph;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];

  let rootGreetingNode = nodes.find((n: any) => n.id === "node-greeting");
  if (!rootGreetingNode) {
    const triggerNode = nodes.find((n: any) => n.type === "TRIGGER_INBOUND");
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];
    const edge = edges.find((e: any) => e.source === triggerNode?.id && e.sourceHandle === "out_customer");
    if (edge) {
      rootGreetingNode = nodes.find((n: any) => n.id === edge.target);
    }
  }

  const currentGreeting = String(
    rootGreetingNode?.data?.greeting_text ||
    rootGreetingNode?.data?.message_text ||
    config?.customer_greeting?.greeting_text ||
    ""
  );

  const isContaminated =
    currentGreeting.toLowerCase().includes("katalog") ||
    currentGreeting.toLowerCase().includes("drive.google.com");

  console.log(`[REPAIR-GREETING] Status sapaan saat ini: ${isContaminated ? "TERKONTAMINASI" : "BERSIH"}`);
  console.log(`[REPAIR-GREETING] Cuplikan teks: ${currentGreeting.slice(0, 80).replace(/\n/g, " ")}...`);

  if (!isContaminated) {
    console.log("[REPAIR-GREETING] Sapaan sudah bersih. Tidak ada tindakan yang diperlukan.");
    return;
  }

  const repairedText = DEFAULT_GREETING;

  if (rootGreetingNode && rootGreetingNode.data) {
    rootGreetingNode.data.greeting_text = repairedText;
    rootGreetingNode.data.message_text = repairedText;
  }
  if (config.customer_greeting) {
    config.customer_greeting.greeting_text = repairedText;
  }

  if (isApply) {
    await prisma.pipelineConfig.update({
      where: { id: row.id },
      data: { config_json: config },
    });
    console.log("[REPAIR-GREETING] Sapaan berhasil diperbaiki dan disimpan ke database.");
  } else {
    console.log("[REPAIR-GREETING] [SIMULASI] Perbaikan terdeteksi. Jalankan dengan --apply untuk menyimpan.");
  }
}

main()
  .catch((err) => {
    console.error("[REPAIR-GREETING] Terjadi kesalahan:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
