import type { PipelineConfigData, PipelineGraph } from "./schema";

export type PresetKey = "FLORIST_DECOR" | "GENERIC_COMMERCE" | "PERSONAL_ASSISTANT";

export interface PresetDefinition {
  key: PresetKey;
  name: string;
  description: string;
  config: PipelineConfigData;
}

export function buildDefaultPresetGraph(
  config: Omit<PipelineConfigData, "graph">
): PipelineGraph {
  const nodes = [
    {
      id: "node-trigger",
      type: "TRIGGER_INBOUND" as const,
      position: { x: 60, y: 220 },
      data: {
        label: "Pintu Masuk & Filter",
        ...config.inbound_gate,
      },
    },
    {
      id: "node-owner-ai",
      type: "OWNER_AI_AGENT" as const,
      position: { x: 420, y: 460 },
      data: {
        label: "Asisten Operasional Owner",
        ...config.owner_assistant,
      },
    },
    {
      id: "node-greeting",
      type: "MESSAGE_MENU" as const,
      position: { x: 420, y: 140 },
      data: {
        label: "Sapaan & Menu Pelanggan",
        message_text: config.customer_greeting.greeting_text,
        set_state: "AWAITING_CHOICE",
        enabled: config.customer_greeting.enabled,
      },
    },
    {
      id: "node-router",
      type: "CONDITION_ROUTER" as const,
      position: { x: 760, y: 140 },
      data: {
        label: "Router Kata Kunci",
        branches: [
          {
            id: "branch_1",
            label: "Pilihan 1 (Order)",
            keywords: config.customer_greeting.order_trigger_keywords,
          },
          {
            id: "branch_2",
            label: "Pilihan 2 (Tanya)",
            keywords: config.customer_greeting.ask_trigger_keywords,
          },
          {
            id: "branch_3",
            label: "Cabang 3 (Kustom)",
            keywords: [],
          },
        ],
        branch_1_keywords: config.customer_greeting.order_trigger_keywords,
        branch_2_keywords: config.customer_greeting.ask_trigger_keywords,
        branch_custom_keywords: [],
        fallback_reply_text: config.customer_greeting.unrecognized_choice_text,
        enabled: config.customer_greeting.enabled,
      },
    },
    {
      id: "node-order-form",
      type: "ORDER_FORM_PROCESSOR" as const,
      position: { x: 1120, y: 60 },
      data: {
        label: "Formulir & Ekstraksi Pesanan",
        ...config.order_form,
      },
    },
    {
      id: "node-handover",
      type: "CS_HANDOVER" as const,
      position: { x: 1120, y: 280 },
      data: {
        label: "Handover CS & Jeda Bot",
        ...config.cs_handover,
      },
    },
    {
      id: "node-fulfillment",
      type: "ORDER_FULFILLMENT" as const,
      position: { x: 1480, y: 60 },
      data: {
        label: "Pencatatan & Konfirmasi Order",
        ...config.order_confirmation,
        lock_customer_session: true,
      },
    },
  ];

  const edges = [
    {
      id: "edge-trigger-owner",
      source: "node-trigger",
      sourceHandle: "out_owner",
      target: "node-owner-ai",
      targetHandle: "in",
      label: "Nomor Owner",
    },
    {
      id: "edge-trigger-customer",
      source: "node-trigger",
      sourceHandle: "out_customer",
      target: "node-greeting",
      targetHandle: "in",
      label: "Pelanggan Baru",
    },
    {
      id: "edge-greeting-router",
      source: "node-greeting",
      sourceHandle: "out_next",
      target: "node-router",
      targetHandle: "in",
      label: "Lanjut Evaluasi",
    },
    {
      id: "edge-router-order",
      source: "node-router",
      sourceHandle: "branch_1",
      target: "node-order-form",
      targetHandle: "in",
      label: "Pilihan 1 · Order",
    },
    {
      id: "edge-router-ask",
      source: "node-router",
      sourceHandle: "branch_2",
      target: "node-handover",
      targetHandle: "in",
      label: "Pilihan 2 · Tanya CS",
    },
    {
      id: "edge-order-fulfillment",
      source: "node-order-form",
      sourceHandle: "out_valid",
      target: "node-fulfillment",
      targetHandle: "in",
      label: "Form Lengkap",
    },
  ];

  return { nodes, edges };
}

const FLORIST_DECOR_BASE: Omit<PipelineConfigData, "graph"> = {
  inbound_gate: {
    enabled: true,
    allow_unregistered_customers: true,
    ignore_groups: true,
    rate_limit_per_minute: 20,
    mute_bot_on_active_order: true,
  },
  customer_greeting: {
    enabled: true,
    greeting_text: `Halo, selamat datang di *Berseri Florist & Decor*! 🌸✨
Senang sekali Kakak menghubungi kami. Ada yang bisa kami bantu hari ini?
1️⃣ *Langsung Pesan* (Buket Bunga / Dekorasi Acara)
2️⃣ *Tanya-tanya / Konsultasi Dulu*
_(Balas dengan angka *1* atau *2* ya Kak)_`,
    order_trigger_keywords: ["1", "pesan", "order", "beli"],
    ask_trigger_keywords: ["2", "tanya", "konsul", "konsultasi", "nanya", "info"],
    unrecognized_choice_text: `Mohon maaf Kak, kami belum menangkap pilihannya 🙏
Balas *1* untuk langsung pesan, atau *2* untuk tanya-tanya dulu ya Kak.`,
  },
  order_form: {
    enabled: true,
    form_template_text: `Baik Kak! Silakan lengkapi formulir pesanan di bawah ini agar pesanan Kakak bisa langsung kami jadwalkan:

*FORMAT PESANAN BERSERI*
• Nama Pemesan:
• Jenis Pesanan (Buket / Bunga Meja / Dekor Lamaran / dll):
• Tanggal Acara / Pengiriman:
• Jam Pengiriman:
• Alamat / Lokasi:
• Request Khusus (Warna bunga / Tulisan kartu ucapan):

_Salin dan isi format di atas lalu kirim kembali ke chat ini ya Kak!_ 🌸`,
    required_fields: [
      "nama_pemesan",
      "jenis_pesanan",
      "tanggal_acara",
      "alamat",
    ],
    missing_fields_prefix:
      "Terima kasih Kak! Namun beberapa data pesanan berikut masih belum lengkap:",
    enable_llm_fallback: true,
  },
  cs_handover: {
    enabled: true,
    handover_customer_text: `Siap Kak! Pertanyaan Kakak sudah kami sampaikan ke Owner Berseri.
Saat ini bot kami jeda sejenak agar *Owner kami bisa langsung membalas chat Kakak secara manual* di sini. Mohon ditunggu sebentar ya Kak! ☕🌸`,
    pause_ttl_hours: 24,
    notify_owner: true,
    owner_handover_alert_template: `🔔 *Halo Owner Berseri! Ada Pelanggan Butuh Bantuan Manual*
• *Nomor Pelanggan:* {{customer_phone}}
• *Pesan Terakhir:* "{{last_message}}"
_(Bot otomatis dinonaktifkan sementara untuk nomor ini. Silakan balas chat langsung di WhatsApp. Jika pelanggan deal memesan, kirim format pesanan di chat tersebut agar bot mencatat otomatis.)_`,
  },
  order_confirmation: {
    enabled: true,
    customer_confirmation_template: `Yeay, terima kasih Kak! 🌸
Pesanan Kakak sudah otomatis tercatat ke dalam sistem operasional Berseri:
📋 *No. Pesanan:* {{order_id}}
👤 *Pemesan:* {{customer_name}}
💐 *Layanan:* {{service_type}}
📅 *Tanggal:* {{event_date}}
⏰ *Jam:* {{delivery_time}}
📍 *Lokasi:* {{delivery_address}}
📝 *Catatan:* {{special_notes}}
Tim kami akan segera menyiapkan pesanan terbaik untuk Kakak. Jika ada perubahan detail, silakan kabari kami ya!`,
    notify_owner_on_new_order: true,
    owner_new_order_alert_template: `🔔 *Pesanan Baru Masuk!* 🌸✨

• Pemesan: *{{customer_name}}* ({{customer_phone}})
• Layanan: {{service_type}}
• Tanggal Acara: {{event_date}} · {{delivery_time}}
• Lokasi: {{delivery_address}}
• Catatan: {{special_notes}}
• Status: {{payment_status}}

Pesanan sudah otomatis dicatat ke sistem.`,
  },
  owner_assistant: {
    enabled: true,
    enable_todo_tools: true,
    enable_order_tools: true,
    enable_voice_note_stt: true,
  },
};

export const FLORIST_DECOR_PRESET: PipelineConfigData = {
  ...FLORIST_DECOR_BASE,
  graph: buildDefaultPresetGraph(FLORIST_DECOR_BASE),
};

const GENERIC_COMMERCE_BASE: Omit<PipelineConfigData, "graph"> = {
  inbound_gate: {
    enabled: true,
    allow_unregistered_customers: true,
    ignore_groups: true,
    rate_limit_per_minute: 25,
    mute_bot_on_active_order: true,
  },
  customer_greeting: {
    enabled: true,
    greeting_text: `Halo, selamat datang! Ada yang bisa kami bantu hari ini?
1️⃣ *Buat Pesanan Baru*
2️⃣ *Tanya-tanya / Bantuan CS*
_(Balas dengan angka *1* atau *2*)_`,
    order_trigger_keywords: ["1", "pesan", "order", "beli", "booking"],
    ask_trigger_keywords: ["2", "tanya", "konsul", "konsultasi", "bantuan", "info"],
    unrecognized_choice_text: `Mohon maaf, pilihan belum sesuai.
Balas *1* untuk membuat pesanan, atau *2* untuk berbicara dengan admin.`,
  },
  order_form: {
    enabled: true,
    form_template_text: `Silakan isi data pemesanan berikut:

*FORMULIR PESANAN*
• Nama Pemesan:
• Jenis Pesanan / Produk:
• Tanggal Pengiriman / Acara:
• Jam Pengiriman:
• Alamat Lengkap:
• Catatan Khusus:`,
    required_fields: [
      "nama_pemesan",
      "jenis_pesanan",
      "tanggal_acara",
      "alamat",
    ],
    missing_fields_prefix:
      "Terima kasih! Masih ada data pesanan yang belum terisi:",
    enable_llm_fallback: true,
  },
  cs_handover: {
    enabled: true,
    handover_customer_text: `Pertanyaan Anda telah kami teruskan ke admin kami.
Admin akan segera membalas pesan Anda di sini secara manual. Mohon ditunggu sebentar ya!`,
    pause_ttl_hours: 24,
    notify_owner: true,
    owner_handover_alert_template: `🔔 *Notifikasi Bantuan CS Pelanggan*
• *Nomor:* {{customer_phone}}
• *Pesan:* "{{last_message}}"
_(Bot dijeda sementara untuk obrolan manual.)_`,
  },
  order_confirmation: {
    enabled: true,
    customer_confirmation_template: `Pesanan Anda berhasil dicatat ke sistem:
📋 *No. Pesanan:* {{order_id}}
👤 *Pemesan:* {{customer_name}}
📦 *Produk:* {{service_type}}
📅 *Tanggal:* {{event_date}}
⏰ *Waktu:* {{delivery_time}}
📍 *Alamat:* {{delivery_address}}
📝 *Catatan:* {{special_notes}}
Admin kami akan segera menindaklanjuti pesanan Anda. Terima kasih!`,
    notify_owner_on_new_order: true,
    owner_new_order_alert_template: `🔔 *Pesanan Baru Masuk*
• Pemesan: *{{customer_name}}* ({{customer_phone}})
• Produk/Layanan: {{service_type}}
• Tanggal: {{event_date}} · {{delivery_time}}
• Alamat: {{delivery_address}}
• Catatan: {{special_notes}}
• Pembayaran: {{payment_status}}`,
  },
  owner_assistant: {
    enabled: true,
    enable_todo_tools: true,
    enable_order_tools: true,
    enable_voice_note_stt: true,
  },
};

export const GENERIC_COMMERCE_PRESET: PipelineConfigData = {
  ...GENERIC_COMMERCE_BASE,
  graph: buildDefaultPresetGraph(GENERIC_COMMERCE_BASE),
};

const PERSONAL_ASSISTANT_BASE: Omit<PipelineConfigData, "graph"> = {
  inbound_gate: {
    enabled: true,
    allow_unregistered_customers: false,
    ignore_groups: true,
    rate_limit_per_minute: 20,
    mute_bot_on_active_order: false,
  },
  customer_greeting: {
    enabled: false,
    greeting_text: "Halo, bot ini adalah asisten pribadi khusus internal.",
    order_trigger_keywords: ["1", "pesan"],
    ask_trigger_keywords: ["2", "tanya"],
    unrecognized_choice_text: "Menu tidak tersedia.",
  },
  order_form: {
    enabled: false,
    form_template_text: "*FORMULIR NONAKTIF*",
    required_fields: ["nama_pemesan"],
    missing_fields_prefix: "Data belum lengkap:",
    enable_llm_fallback: false,
  },
  cs_handover: {
    enabled: false,
    handover_customer_text: "Bot pribadi tidak melayani percakapan publik.",
    pause_ttl_hours: 24,
    notify_owner: false,
    owner_handover_alert_template: "Pesan dari {{customer_phone}}: {{last_message}}",
  },
  order_confirmation: {
    enabled: false,
    customer_confirmation_template: "Pesanan tercatat: {{order_id}}",
    notify_owner_on_new_order: false,
    owner_new_order_alert_template: "Pesanan baru: {{order_id}}",
  },
  owner_assistant: {
    enabled: true,
    enable_todo_tools: true,
    enable_order_tools: false,
    enable_voice_note_stt: true,
  },
};

export const PERSONAL_ASSISTANT_PRESET: PipelineConfigData = {
  ...PERSONAL_ASSISTANT_BASE,
  graph: buildDefaultPresetGraph(PERSONAL_ASSISTANT_BASE),
};

export const PRESETS: Record<PresetKey, PresetDefinition> = {
  FLORIST_DECOR: {
    key: "FLORIST_DECOR",
    name: "Bisnis Florist & Dekorasi (Default Berseri)",
    description:
      "Preset lengkap untuk usaha buket bunga dan dekorasi acara. Memuat sapaan ramah, alur pemesanan, dan notifikasi owner.",
    config: FLORIST_DECOR_PRESET,
  },
  GENERIC_COMMERCE: {
    key: "GENERIC_COMMERCE",
    name: "UMKM Jasa & Retail Umum",
    description:
      "Preset fleksibel untuk usaha ritel, pemesanan produk, atau penyedia jasa umum dengan penyesuaian teks netral.",
    config: GENERIC_COMMERCE_PRESET,
  },
  PERSONAL_ASSISTANT: {
    key: "PERSONAL_ASSISTANT",
    name: "Asisten Produktivitas Pribadi",
    description:
      "Hanya melayani pemilik terdaftar untuk mencatat to-do dan pengingat harian. Mengabaikan chat pelanggan publik.",
    config: PERSONAL_ASSISTANT_PRESET,
  },
};
