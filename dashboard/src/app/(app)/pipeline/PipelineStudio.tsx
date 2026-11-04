"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  BackgroundVariant,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  PipelineConfigData,
  PipelineNodeType,
  PipelineGraph,
  OrderFormField,
} from "@/lib/pipeline/schema";
import type { ActivePipelineConfig } from "@/lib/pipeline/manager";
import type { PresetDefinition, PresetKey } from "@/lib/pipeline/presets";
import { buildDefaultPresetGraph } from "@/lib/pipeline/presets";
import { renderPipelineTemplate } from "@/lib/pipeline/manager";
import { WhatsAppFormattedText } from "@/lib/pipeline/whatsapp-formatter";
import {
  syncGraphToCoreConfig,
  simulatePipelineExecution,
} from "@/lib/pipeline/graph-runner";
import { PipelineDeletableEdge } from "./PipelineDeletableEdge";

const PREVIEW_DUMMY_VARS = {
  order_id: "#ORD-8F92A10B",
  customer_name: "Maya Anggraini",
  customer_phone: "+6281234567890",
  service_type: "Buket Mawar Putih",
  event_date: "20 November 2026",
  delivery_time: "14:00 WIB",
  delivery_address: "Jl. Tebet Barat Dalam No. 12, Jakarta Selatan",
  special_notes: "Pita warna emas, kartu ucapan: Selamat Ulang Tahun",
  payment_status: "Belum dibayar",
  last_message: "Bisa kirim buket mawar untuk acara besok jam 2 siang?",
};

const ALL_ORDER_FIELDS: Array<{ key: OrderFormField; label: string }> = [
  { key: "nama_pemesan", label: "Nama Pemesan" },
  { key: "jenis_pesanan", label: "Jenis Pesanan" },
  { key: "tanggal_acara", label: "Tanggal Acara / Pengiriman" },
  { key: "jam_pengiriman", label: "Jam Pengiriman" },
  { key: "alamat", label: "Alamat / Lokasi" },
  { key: "request_khusus", label: "Request Khusus" },
];

interface CustomBranchItem {
  id: string;
  label: string;
  keywords: string[];
  raw_input?: string;
}

interface CustomNodeData {
  label?: string;
  enabled?: boolean;
  isSimulated?: boolean;
  branches?: CustomBranchItem[];
  onDeleteNode?: (id: string) => void;
  [key: string]: unknown;
}

// Helper to sequentially re-number custom branches starting from 3 and remap edges
export function normalizeCustomBranches(
  currentBranches: CustomBranchItem[],
  currentEdges: Edge[],
  nodeId = "node-router"
): { normalizedBranches: CustomBranchItem[]; updatedEdges: Edge[] } {
  const b1 = currentBranches.find((b) => b.id === "branch_1") || {
    id: "branch_1",
    label: "Pilihan 1 (Order)",
    keywords: ["1", "pesan"],
  };
  const b2 = currentBranches.find((b) => b.id === "branch_2") || {
    id: "branch_2",
    label: "Pilihan 2 (Tanya)",
    keywords: ["2", "tanya"],
  };

  const nonCore = currentBranches.filter(
    (b) => b.id !== "branch_1" && b.id !== "branch_2"
  );
  const activeCustom = nonCore.filter(
    (b) => b.keywords.length > 0 || (b.raw_input && b.raw_input.trim().length > 0)
  );

  const idRemap = new Map<string, string>();

  const renumbered: CustomBranchItem[] = activeCustom.map((branch, idx) => {
    const num = idx + 3;
    const newId = `branch_${num}`;
    if (branch.id !== newId) {
      idRemap.set(branch.id, newId);
    }
    const defaultLabelPattern = /^Cabang \d+ \(Kustom\)$/i;
    const isDefaultLabel = !branch.label || defaultLabelPattern.test(branch.label);
    const newLabel = isDefaultLabel ? `Cabang ${num} (Kustom)` : branch.label;
    return {
      ...branch,
      id: newId,
      label: newLabel,
    };
  });

  // Always keep exactly 1 empty slot for auto-spawning
  const nextNum = renumbered.length + 3;
  renumbered.push({
    id: `branch_${nextNum}`,
    label: `Cabang ${nextNum} (Kustom)`,
    keywords: [],
    raw_input: "",
  });

  const normalizedBranches = [b1, b2, ...renumbered];

  const updatedEdges = currentEdges.map((edge) => {
    if (edge.source === nodeId && edge.sourceHandle) {
      let currentHandle = edge.sourceHandle;
      if (idRemap.has(currentHandle)) {
        currentHandle = idRemap.get(currentHandle)!;
      }
      const matchingBranch = normalizedBranches.find((b) => b.id === currentHandle);
      let newEdgeLabel = edge.label;
      if (matchingBranch) {
        if (currentHandle === "branch_1") {
          newEdgeLabel = "Pilihan 1 · Order";
        } else if (currentHandle === "branch_2") {
          newEdgeLabel = "Pilihan 2 · Tanya CS";
        } else {
          newEdgeLabel = matchingBranch.label ? `Pilihan · ${matchingBranch.label}` : "Cabang Kustom";
        }
      }
      return {
        ...edge,
        sourceHandle: currentHandle,
        label: newEdgeLabel,
      };
    }
    return edge;
  });

  return { normalizedBranches, updatedEdges };
}

// Reusable Auto-Expanding Textarea
function AutoExpandingTextarea({
  value,
  onChange,
  rows = 4,
  className = "",
  placeholder = "",
}: {
  value: string;
  onChange: (val: string) => void;
  rows?: number;
  className?: string;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(120, textareaRef.current.scrollHeight)}px`;
    }
  }, [value]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = "auto";
    e.target.style.height = `${Math.max(120, e.target.scrollHeight)}px`;
    onChange(e.target.value);
  };

  return (
    <textarea
      ref={textareaRef}
      rows={rows}
      value={value}
      onChange={handleInput}
      placeholder={placeholder}
      className={`field min-h-[120px] max-h-[500px] overflow-y-auto leading-relaxed resize-none font-sans text-stone-900 border-stone-300 focus:border-[#9a3412] ${className}`}
    />
  );
}

// 1. Custom Node Card Component with compliant <Handle> components (Hover UX fixed)
function PipelineNodeCard({ id, data, type, selected }: NodeProps) {
  const nodeData = data as CustomNodeData;
  const isEnabled = nodeData.enabled !== false;
  const isSimulated = nodeData.isSimulated === true;
  const label = typeof nodeData.label === "string" ? nodeData.label : type;

  // Category & Header Theme
  let category = "PROSES";
  let headerBg = "bg-neutral-800 text-neutral-100";
  if (type === "TRIGGER_INBOUND") {
    category = "PINTU MASUK";
    headerBg = "bg-[#2d4a22] text-emerald-100";
  } else if (type === "MESSAGE_MENU") {
    category = "CHAT & MENU";
    headerBg = "bg-[#1e3a5f] text-sky-100";
  } else if (type === "CONDITION_ROUTER") {
    category = "ROUTER PERCABANGAN";
    headerBg = "bg-[#7c2d12] text-amber-100";
  } else if (type === "ORDER_FORM_PROCESSOR") {
    category = "FORMULIR ORDER";
    headerBg = "bg-[#831843] text-pink-100";
  } else if (type === "CS_HANDOVER") {
    category = "HANDOVER CS";
    headerBg = "bg-[#713f12] text-amber-200";
  } else if (type === "ORDER_FULFILLMENT") {
    category = "KONFIRMASI ORDER";
    headerBg = "bg-[#14532d] text-emerald-100";
  } else if (type === "CUSTOM_WA_REPLY") {
    category = "CHAT KUSTOM";
    headerBg = "bg-[#4c1d95] text-purple-100";
  } else if (type === "OWNER_AI_AGENT") {
    category = "ASISTEN OWNER";
    headerBg = "bg-[#18181b] text-neutral-200";
  }

  const isCustomNode = type === "CUSTOM_WA_REPLY" || id.startsWith("custom-");

  // Dynamic Branches for Router
  const dynamicBranches: CustomBranchItem[] =
    type === "CONDITION_ROUTER"
      ? Array.isArray(nodeData.branches) && nodeData.branches.length > 0
        ? nodeData.branches
        : [
            { id: "branch_1", label: "Pilihan 1 (Order)", keywords: (nodeData.branch_1_keywords as string[]) || ["1", "pesan"] },
            { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: (nodeData.branch_2_keywords as string[]) || ["2", "tanya"] },
            { id: "branch_3", label: "Cabang 3 (Kustom)", keywords: (nodeData.branch_custom_keywords as string[]) || [] },
          ]
      : [];

  return (
    <div
      className={`relative min-w-[240px] max-w-[280px] rounded-lg border bg-[#fffdf8] text-xs shadow-sm cursor-pointer select-none transition-all ${
        selected
          ? "border-[#9a3412] ring-2 ring-[#9a3412] shadow-md"
          : isSimulated
            ? "border-[#9a3412] ring-2 ring-[#9a3412] shadow-md"
            : isEnabled
              ? "border-[#d8d0c0] hover:border-[#9a3412]"
              : "border-neutral-300 opacity-60"
      }`}
    >
      {/* Target Handle (Input) on Left Border (No transform overrides, smooth ring hover) */}
      {type !== "TRIGGER_INBOUND" && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          isConnectable={true}
          className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-stone-800 hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
          style={{ top: "50%", left: -7 }}
        />
      )}

      {/* Header */}
      <div className={`flex items-center justify-between rounded-t-lg px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider ${headerBg}`}>
        <span>{category}</span>
        <div className="flex items-center gap-1.5">
          {isCustomNode && nodeData.onDeleteNode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                nodeData.onDeleteNode?.(id);
              }}
              title="Hapus Kontainer Ini"
              className="text-neutral-300 hover:text-red-300 text-xs px-1 cursor-pointer"
            >
              x
            </button>
          )}
          <span className={`inline-block h-2 w-2 rounded-full ${isEnabled ? "bg-emerald-400" : "bg-neutral-500"}`} />
        </div>
      </div>

      {/* Body Summary */}
      <div className="p-3">
        <h4 className="font-bold text-[#1c1917] text-xs leading-snug">{label}</h4>

        {type === "TRIGGER_INBOUND" && (
          <p className="mt-1 text-[11px] text-neutral-600">
            Rate limit: {String(nodeData.rate_limit_per_minute || 20)} msg/m · Filter grup
          </p>
        )}

        {type === "MESSAGE_MENU" && (
          <p className="mt-1 text-[11px] text-neutral-600 line-clamp-2 italic">
            &ldquo;{String(nodeData.message_text || nodeData.greeting_text || "").slice(0, 60)}...&rdquo;
          </p>
        )}

        {type === "CONDITION_ROUTER" && (
          <div className="mt-1 flex flex-col gap-0.5 text-[10px] font-mono text-neutral-600">
            <span>{dynamicBranches.length} cabang terdaftar</span>
          </div>
        )}

        {type === "ORDER_FORM_PROCESSOR" && (
          <p className="mt-1 text-[11px] text-neutral-600">
            {Array.isArray(nodeData.required_fields) ? nodeData.required_fields.length : 4} field wajib · AI Fallback
          </p>
        )}

        {type === "CS_HANDOVER" && (
          <p className="mt-1 text-[11px] text-neutral-600">
            Pause: {String(nodeData.pause_ttl_hours || 24)} jam · Alert: {nodeData.notify_owner ? "Ya" : "Tidak"}
          </p>
        )}

        {type === "ORDER_FULFILLMENT" && (
          <p className="mt-1 text-[11px] text-neutral-600">
            Konfirmasi Klien &amp; Alert Owner Instan
          </p>
        )}

        {type === "CUSTOM_WA_REPLY" && (
          <p className="mt-1 text-[11px] text-purple-900 line-clamp-2">
            Target: {String(nodeData.recipient_type || "CUSTOMER")} · &ldquo;{String(nodeData.message_template || "").slice(0, 50)}...&rdquo;
          </p>
        )}

        {type === "OWNER_AI_AGENT" && (
          <p className="mt-1 text-[11px] text-neutral-600">
            To-Do Engine · Order Tools · STT Audio
          </p>
        )}
      </div>

      {/* Source Handles (Outputs) on Right Border with Stable Port Rows */}
      {type === "TRIGGER_INBOUND" && (
        <div className="flex flex-col border-t border-[#d8d0c0]">
          <div className="relative flex items-center justify-between px-3 py-1.5 text-[10px] font-mono text-neutral-600">
            <span>Pelanggan Baru</span>
            <Handle
              type="source"
              position={Position.Right}
              id="out_customer"
              isConnectable={true}
              className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-[#0284c7] hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
              style={{ top: "50%", right: -7 }}
            />
          </div>
          <div className="relative flex items-center justify-between border-t border-[#e7e0d0] px-3 py-1.5 text-[10px] font-mono text-neutral-600">
            <span>Nomor Owner</span>
            <Handle
              type="source"
              position={Position.Right}
              id="out_owner"
              isConnectable={true}
              className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-stone-800 hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
              style={{ top: "50%", right: -7 }}
            />
          </div>
        </div>
      )}

      {type === "MESSAGE_MENU" && (
        <div className="relative flex items-center justify-between border-t border-[#d8d0c0] px-3 py-1.5 text-[10px] font-mono text-neutral-600">
          <span>Lanjut Evaluasi</span>
          <Handle
            type="source"
            position={Position.Right}
            id="out_next"
            isConnectable={true}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-[#0284c7] hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
            style={{ top: "50%", right: -7 }}
          />
        </div>
      )}

      {type === "CONDITION_ROUTER" && (
        <div className="flex flex-col border-t border-[#d8d0c0]">
          {dynamicBranches.map((branch, bIdx) => {
            const isCustom = bIdx >= 2;
            const colorClass =
              bIdx === 0
                ? "!bg-[#9a3412]"
                : bIdx === 1
                  ? "!bg-[#b45309]"
                  : "!bg-[#7c3aed]";
            const textClass = isCustom ? "text-purple-700" : "text-neutral-600";
            return (
              <div
                key={branch.id}
                className={`relative flex items-center justify-between ${
                  bIdx > 0 ? "border-t border-[#e7e0d0]" : ""
                } px-3 py-1.5 text-[10px] font-mono ${textClass}`}
              >
                <span className="font-mono text-[11px] text-stone-700 truncate pr-3">
                  {branch.label || `Cabang ${bIdx + 1}`}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={branch.id}
                  isConnectable={true}
                  className={`!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] ${colorClass} hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30`}
                  style={{ top: "50%", right: -7 }}
                />
              </div>
            );
          })}
          <div className="relative flex items-center justify-between border-t border-[#e7e0d0] px-3 py-1.5 text-[10px] font-mono text-neutral-400">
            <span>Fallback</span>
            <Handle
              type="source"
              position={Position.Right}
              id="branch_fallback"
              isConnectable={true}
              className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-neutral-400 hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
              style={{ top: "50%", right: -7 }}
            />
          </div>
        </div>
      )}

      {type === "ORDER_FORM_PROCESSOR" && (
        <div className="flex flex-col border-t border-[#d8d0c0]">
          <div className="relative flex items-center justify-between px-3 py-1.5 text-[10px] font-mono text-emerald-700">
            <span>Form Lengkap</span>
            <Handle
              type="source"
              position={Position.Right}
              id="out_valid"
              isConnectable={true}
              className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-emerald-600 hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
              style={{ top: "50%", right: -7 }}
            />
          </div>
          <div className="relative flex items-center justify-between border-t border-[#e7e0d0] px-3 py-1.5 text-[10px] font-mono text-neutral-500">
            <span>Form Kurang</span>
            <Handle
              type="source"
              position={Position.Right}
              id="out_incomplete"
              isConnectable={true}
              className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-amber-600 hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
              style={{ top: "50%", right: -7 }}
            />
          </div>
        </div>
      )}

      {type === "CUSTOM_WA_REPLY" && (
        <div className="relative flex items-center justify-between border-t border-[#d8d0c0] px-3 py-1.5 text-[10px] font-mono text-purple-700">
          <span>Lanjut Rantai</span>
          <Handle
            type="source"
            position={Position.Right}
            id="out_next"
            isConnectable={true}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-[#7c3aed] hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
            style={{ top: "50%", right: -7 }}
          />
        </div>
      )}

      {(type === "CS_HANDOVER" || type === "ORDER_FULFILLMENT") && (
        <div className="relative flex items-center justify-between border-t border-[#d8d0c0] px-3 py-1.5 text-[10px] font-mono text-neutral-500">
          <span>Selesai / Alert</span>
          <Handle
            type="source"
            position={Position.Right}
            id="out_done"
            isConnectable={true}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[#fffdf8] !bg-stone-800 hover:!bg-[#9a3412] hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150 cursor-crosshair !z-30"
            style={{ top: "50%", right: -7 }}
          />
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  TRIGGER_INBOUND: PipelineNodeCard,
  MESSAGE_MENU: PipelineNodeCard,
  CONDITION_ROUTER: PipelineNodeCard,
  ORDER_FORM_PROCESSOR: PipelineNodeCard,
  CS_HANDOVER: PipelineNodeCard,
  ORDER_FULFILLMENT: PipelineNodeCard,
  CUSTOM_WA_REPLY: PipelineNodeCard,
  OWNER_AI_AGENT: PipelineNodeCard,
};

const edgeTypes = {
  smoothstep: PipelineDeletableEdge,
  deletable: PipelineDeletableEdge,
  default: PipelineDeletableEdge,
};

interface CatalogItem {
  type: PipelineNodeType;
  title: string;
  badge: string;
  desc: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
  badgeBg: string;
}

const CATALOG_ITEMS: CatalogItem[] = [
  {
    type: "TRIGGER_INBOUND",
    title: "Pintu Masuk & Filter Keamanan",
    badge: "PINTU MASUK",
    desc: "Gerbang penerima webhook WhatsApp, filter grup, rate limiter, dan mute order aktif.",
    borderClass: "border-emerald-200 hover:border-emerald-400",
    bgClass: "bg-emerald-50",
    textClass: "text-emerald-900",
    badgeBg: "bg-[#2d4a22] text-emerald-100",
  },
  {
    type: "MESSAGE_MENU",
    title: "Menu / Sapaan Pelanggan",
    badge: "CHAT & MENU",
    desc: "Kirim pesan sapaan atau menu interaktif ke pelanggan dan atur status sesi percakapan.",
    borderClass: "border-sky-200 hover:border-sky-400",
    bgClass: "bg-sky-50",
    textClass: "text-sky-900",
    badgeBg: "bg-[#1e3a5f] text-sky-100",
  },
  {
    type: "CONDITION_ROUTER",
    title: "Router Percabangan Kata Kunci",
    badge: "ROUTER PERCABANGAN",
    desc: "Evaluasi kata kunci balasan pelanggan dan arahkan ke berbagai cabang berbeda.",
    borderClass: "border-amber-200 hover:border-amber-400",
    bgClass: "bg-amber-50",
    textClass: "text-amber-900",
    badgeBg: "bg-[#7c2d12] text-amber-100",
  },
  {
    type: "ORDER_FORM_PROCESSOR",
    title: "Formulir & Ekstraksi Pesanan",
    badge: "FORMULIR ORDER",
    desc: "Kirim template form pesanan kosong dan validasi kelengkapan data pesanan pelanggan.",
    borderClass: "border-pink-200 hover:border-pink-400",
    bgClass: "bg-pink-50",
    textClass: "text-pink-900",
    badgeBg: "bg-[#831843] text-pink-100",
  },
  {
    type: "ORDER_FULFILLMENT",
    title: "Pencatatan & Konfirmasi Order",
    badge: "KONFIRMASI ORDER",
    desc: "Simpan pesanan ke database 'orders', kirim konfirmasi klien, dan kirim alert ke Owner.",
    borderClass: "border-emerald-200 hover:border-emerald-400",
    bgClass: "bg-emerald-50",
    textClass: "text-emerald-900",
    badgeBg: "bg-[#14532d] text-emerald-100",
  },
  {
    type: "CS_HANDOVER",
    title: "Handover CS & Jeda Bot",
    badge: "HANDOVER CS",
    desc: "Alihkan percakapan ke admin manusia, jeda bot sementara, dan kirim notifikasi ke Owner.",
    borderClass: "border-amber-200 hover:border-amber-400",
    bgClass: "bg-amber-50",
    textClass: "text-amber-900",
    badgeBg: "bg-[#713f12] text-amber-200",
  },
  {
    type: "CUSTOM_WA_REPLY",
    title: "Kirim Chat WhatsApp Kustom",
    badge: "CHAT KUSTOM",
    desc: "Kirim pesan WhatsApp kustom tambahan ke pelanggan atau nomor admin (bisa berantai).",
    borderClass: "border-purple-200 hover:border-purple-400",
    bgClass: "bg-purple-50",
    textClass: "text-purple-900",
    badgeBg: "bg-[#4c1d95] text-purple-100",
  },
  {
    type: "OWNER_AI_AGENT",
    title: "Asisten Operasional Owner (AI Tools)",
    badge: "ASISTEN OWNER",
    desc: "Modul AI Agent internal pemilik untuk kelola To-Do, Order, dan transkripsi Voice Note.",
    borderClass: "border-stone-200 hover:border-stone-400",
    bgClass: "bg-stone-50",
    textClass: "text-stone-900",
    badgeBg: "bg-[#18181b] text-neutral-200",
  },
];

export function PipelineStudio({
  initialPipeline,
  presets,
}: {
  initialPipeline: ActivePipelineConfig;
  presets: Record<PresetKey, PresetDefinition>;
}) {
  const router = useRouter();
  const [pipeline, setPipeline] = useState<ActivePipelineConfig>(initialPipeline);
  const [config, setConfig] = useState<PipelineConfigData>(initialPipeline.config);

  const initialGraph: PipelineGraph = useMemo(() => {
    if (initialPipeline.config.graph && initialPipeline.config.graph.nodes.length > 0) {
      return initialPipeline.config.graph;
    }
    return buildDefaultPresetGraph(initialPipeline.config);
  }, [initialPipeline]);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialGraph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        ...n.data,
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      },
    }))
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialGraph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      label: e.label,
      type: "smoothstep",
      animated: false,
      style: { stroke: "#78716c", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#78716c" },
      data: {
        onDelete: (edgeId: string) => handleDeleteEdge(edgeId),
      },
    }))
  );

  // Inspector state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("node-greeting");
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Simulation state
  const [simRole, setSimRole] = useState<"CUSTOMER" | "OWNER">("CUSTOMER");
  const [simState, setSimState] = useState<"INIT" | "AWAITING_CHOICE" | "AWAITING_ORDER" | "PAUSED_FOR_OWNER" | "ACTIVE">("AWAITING_CHOICE");
  const [simInput, setSimInput] = useState<string>("1");
  const [simActiveRouterId, setSimActiveRouterId] = useState<string | undefined>(undefined);
  const [simResult, setSimResult] = useState<{
    visited: string[];
    replies: string[];
    logs: string[];
    nextState: string;
  } | null>(null);

  // Close inspector on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsInspectorOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // onConnect: creates clean smoothstep edge between handles with deletable capability and auto-labels
  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      let edgeLabel: string | undefined = undefined;

      if (connection.sourceHandle === "branch_1") {
        edgeLabel = "Pilihan 1 · Order";
      } else if (connection.sourceHandle === "branch_2") {
        edgeLabel = "Pilihan 2 · Tanya CS";
      } else if (connection.sourceHandle === "out_customer") {
        edgeLabel = "Pelanggan Baru";
      } else if (connection.sourceHandle === "out_owner") {
        edgeLabel = "Nomor Owner";
      } else if (connection.sourceHandle === "out_valid") {
        edgeLabel = "Form Lengkap";
      } else if (connection.sourceHandle === "out_incomplete") {
        edgeLabel = "Form Kurang";
      } else if (connection.sourceHandle === "out_next") {
        edgeLabel = "Lanjut Rantai";
      } else if (connection.sourceHandle === "out_done") {
        edgeLabel = "Selesai / Alert";
      } else if (connection.sourceHandle?.startsWith("branch_")) {
        const branches = sourceNode?.data?.branches as CustomBranchItem[] | undefined;
        const branchObj = branches?.find((b) => b.id === connection.sourceHandle);
        edgeLabel = branchObj?.label ? `Pilihan · ${branchObj.label}` : "Cabang Kustom";
      }

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            animated: true,
            label: edgeLabel,
            data: {
              onDelete: (edgeId: string) => handleDeleteEdge(edgeId),
            },
            style: { stroke: "#9a3412", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#9a3412" },
          },
          eds
        )
      );
    },
    [nodes, setEdges, handleDeleteEdge]
  );

  // onNodeClick: selects node and opens slide-over inspector drawer
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setIsInspectorOpen(true);
  }, []);

  // onPaneClick: clicking empty canvas closes inspector drawer
  const onPaneClick = useCallback(() => {
    setIsInspectorOpen(false);
  }, []);

  // Delete node and connected edges
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
        setIsInspectorOpen(false);
      }
    },
    [setNodes, setEdges, selectedNodeId]
  );

  // Add a new modular node from catalog
  function handleAddNode(type: PipelineNodeType) {
    if (type === "TRIGGER_INBOUND" && nodes.some((n) => n.type === "TRIGGER_INBOUND")) {
      return;
    }

    const newId = `custom-${type.toLowerCase()}-${Date.now().toString().slice(-4)}`;
    const randomOffset = Math.floor(Math.random() * 60);

    let defaultData: Record<string, unknown> = {
      label: "Node Baru",
      enabled: true,
      onDeleteNode: (delId: string) => handleDeleteNode(delId),
    };

    if (type === "TRIGGER_INBOUND") {
      defaultData = {
        label: "Pintu Masuk & Filter",
        enabled: true,
        allow_unregistered_customers: true,
        ignore_groups: true,
        rate_limit_per_minute: 20,
        mute_bot_on_active_order: true,
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    } else if (type === "MESSAGE_MENU") {
      defaultData = {
        label: "Menu / Sapaan Baru",
        enabled: true,
        message_text: config.customer_greeting.greeting_text || "Halo, selamat datang!",
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    } else if (type === "CONDITION_ROUTER") {
      defaultData = {
        label: "Router Kata Kunci",
        enabled: true,
        branches: [
          { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
          { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
          { id: "branch_3", label: "Cabang 3 (Kustom)", keywords: [] },
        ],
        fallback_reply_text: "Mohon maaf, pilihan belum sesuai.",
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    } else if (type === "ORDER_FORM_PROCESSOR") {
      defaultData = {
        label: "Formulir & Ekstraksi Pesanan",
        enabled: true,
        form_template_text: config.order_form.form_template_text,
        required_fields: ["nama_pemesan", "jenis_pesanan", "tanggal_acara", "alamat"],
        missing_fields_prefix: "Terima kasih! Namun beberapa data pesanan berikut masih belum lengkap:",
        enable_llm_fallback: true,
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    } else if (type === "ORDER_FULFILLMENT") {
      defaultData = {
        label: "Pencatatan & Konfirmasi Order",
        enabled: true,
        customer_confirmation_template: config.order_confirmation.customer_confirmation_template,
        notify_owner_on_new_order: true,
        owner_new_order_alert_template: config.order_confirmation.owner_new_order_alert_template,
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    } else if (type === "CS_HANDOVER") {
      defaultData = {
        label: "Handover CS & Jeda Bot",
        enabled: true,
        handover_customer_text: config.cs_handover.handover_customer_text,
        pause_ttl_hours: 24,
        notify_owner: true,
        owner_handover_alert_template: config.cs_handover.owner_handover_alert_template,
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    } else if (type === "CUSTOM_WA_REPLY") {
      defaultData = {
        label: "Kirim Chat Kustom",
        enabled: true,
        recipient_type: "CUSTOMER",
        custom_phone: "",
        message_template: "Halo {{customer_name}}, ada informasi tambahan untuk pesanan Anda!",
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    } else if (type === "OWNER_AI_AGENT") {
      defaultData = {
        label: "Asisten Operasional Owner",
        enabled: true,
        enable_todo_tools: true,
        enable_order_tools: true,
        enable_voice_note_stt: true,
        onDeleteNode: (delId: string) => handleDeleteNode(delId),
      };
    }

    const newNode: Node = {
      id: newId,
      type,
      position: { x: 760 + randomOffset, y: 320 + randomOffset },
      data: defaultData,
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newId);
    setIsInspectorOpen(true);
    setShowAddModal(false);
  }

  // Reset node layout to default preset grid
  function handleResetLayout() {
    const defaultGraph = buildDefaultPresetGraph(config);
    setNodes(
      defaultGraph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          ...n.data,
          onDeleteNode: (delId: string) => handleDeleteNode(delId),
        },
      }))
    );
    setEdges(
      defaultGraph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        label: e.label,
        type: "smoothstep",
        style: { stroke: "#78716c", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#78716c" },
        data: {
          onDelete: (edgeId: string) => handleDeleteEdge(edgeId),
        },
      }))
    );
  }

  // Update selected node data
  function updateSelectedNodeData(patch: Record<string, unknown>) {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNodeId) {
          return {
            ...n,
            data: {
              ...n.data,
              ...patch,
            },
          };
        }
        return n;
      })
    );
  }

  // Run simulation trace
  function handleRunSimulation() {
    const currentGraph: PipelineGraph = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as PipelineNodeType,
        position: n.position,
        data: n.data as Record<string, unknown>,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        label: typeof e.label === "string" ? e.label : undefined,
      })),
    };

    const synced = syncGraphToCoreConfig(currentGraph, config);
    const result = simulatePipelineExecution(synced, simInput, simState, simRole, simActiveRouterId);

    if (result.next_state === "AWAITING_CHOICE") {
      setSimActiveRouterId(result.active_router_id);
    } else {
      setSimActiveRouterId(undefined);
    }

    setSimResult({
      visited: result.visited_node_ids,
      replies: result.replies,
      logs: result.log,
      nextState: result.next_state,
    });

    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isSimulated: result.visited_node_ids.includes(n.id),
        },
      }))
    );

    setEdges((eds) =>
      eds.map((e) => {
        const isActive = result.active_edge_ids.includes(e.id);
        return {
          ...e,
          animated: isActive,
          style: {
            stroke: isActive ? "#9a3412" : "#78716c",
            strokeWidth: isActive ? 3 : 2,
          },
        };
      })
    );
  }

  // Save pipeline configuration
  async function handleSavePipeline() {
    setSaving(true);
    setMessage(null);

    try {
      const currentGraph: PipelineGraph = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type as PipelineNodeType,
          position: n.position,
          data: n.data as Record<string, unknown>,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
          label: typeof e.label === "string" ? e.label : undefined,
        })),
      };

      const finalConfig = syncGraphToCoreConfig(currentGraph, config);

      const res = await fetch("/api/pipeline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pipeline.name,
          preset_key: pipeline.preset_key,
          config: finalConfig,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Gagal menyimpan konfigurasi.");
      }

      setPipeline(data.pipeline);
      setConfig(data.pipeline.config);
      setMessage({
        type: "success",
        text: `Pipeline berhasil disimpan dan aktif di runtime (versi ${data.pipeline.version}).`,
      });
      router.refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Terjadi kesalahan saat menyimpan pipeline.",
      });
    } finally {
      setSaving(false);
    }
  }

  // Selected node & data
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedData = (selectedNode?.data as Record<string, unknown>) || {};
  const isCustomNode =
    selectedNode?.type === "CUSTOM_WA_REPLY" ||
    (selectedNode?.id && selectedNode.id.startsWith("custom-"));

  // Connected edges for the selected node
  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    );
  }, [selectedNode, edges]);

  // Process flowchart explanation per node type
  let processFlowExplanation = "Menerima pesan masuk dan mengevaluasi alur kerja.";
  if (selectedNode?.type === "TRIGGER_INBOUND") {
    processFlowExplanation = "Pesan WhatsApp masuk ──► Filter Keamanan (Rate Limit / Anti-Spam / Grup) ──► Arahkan ke Pelanggan Baru atau Owner";
  } else if (selectedNode?.type === "MESSAGE_MENU") {
    processFlowExplanation = "Menerima chat pelanggan baru ──► Mengirim pesan sapaan T1 & Menu Pilihan ──► Mengubah status sesi ke AWAITING_CHOICE";
  } else if (selectedNode?.type === "CONDITION_ROUTER") {
    processFlowExplanation = "Menerima input pilihan pelanggan ──► Evaluasi Kata Kunci (Order / Tanya / Kustom) ──► Arahkan ke cabang alur berikutnya";
  } else if (selectedNode?.type === "ORDER_FORM_PROCESSOR") {
    processFlowExplanation = "Menerima permintaan order ──► Mengirim format form kosong / Mengekstrak isi data ──► Validasi field wajib";
  } else if (selectedNode?.type === "CS_HANDOVER") {
    processFlowExplanation = "Pelanggan memilih konsultasi ──► Jeda bot (Pause TTL) & kirim alert ke WhatsApp Owner ──► Handover manual";
  } else if (selectedNode?.type === "ORDER_FULFILLMENT") {
    processFlowExplanation = "Formulir order lengkap ──► Simpan ke database 'orders' ──► Kirim konfirmasi T4 & kirim alert instan ke Owner";
  } else if (selectedNode?.type === "CUSTOM_WA_REPLY") {
    processFlowExplanation = "Menerima trigger alur ──► Mengisi template dengan data variabel dinamis ──► Mengirim pesan WhatsApp kustom";
  } else if (selectedNode?.type === "OWNER_AI_AGENT") {
    processFlowExplanation = "Pesan dari nomor Owner ──► Panggil LLM Agent dengan Tools (To-Do / Order / STT) ──► Balas langsung ke chat Owner";
  }

  // Raw preview text for live formatter
  const rawPreviewText = String(
    selectedData.message_text ||
      selectedData.message_template ||
      selectedData.form_template_text ||
      selectedData.handover_customer_text ||
      selectedData.customer_confirmation_template ||
      selectedData.fallback_reply_text ||
      "Pilih kontainer untuk melihat pratinjau pesan."
  );

  const hasTriggerInbound = nodes.some((n) => n.type === "TRIGGER_INBOUND");

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* 1. Header Toolbar */}
      <header className="flex flex-col gap-4 border-b border-[#d8d0c0] pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge badge-accent">Visual Pipeline Studio</span>
            <span className="font-mono text-xs text-[var(--muted)]">v{pipeline.version}</span>
            <span className="font-mono text-xs text-[var(--muted)]">·</span>
            <span className="font-mono text-xs text-[var(--muted)]">Node Canvas Builder</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">
            {pipeline.name}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Preset Picker */}
          <select
            aria-label="Pilih Preset"
            value={pipeline.preset_key}
            onChange={async (e) => {
              const k = e.target.value as PresetKey;
              const p = presets[k];
              if (!p) return;
              if (window.confirm(`Terapkan preset "${p.name}"? Struktur kanvas akan disesuaikan.`)) {
                setSaving(true);
                try {
                  const res = await fetch("/api/pipeline/reset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ preset_key: k }),
                  });
                  const d = await res.json();
                  if (res.ok && d.ok) {
                    setPipeline(d.pipeline);
                    setConfig(d.pipeline.config);
                    const newGraph = d.pipeline.config.graph || buildDefaultPresetGraph(d.pipeline.config);
                    setNodes(
                      newGraph.nodes.map((n: PipelineGraph["nodes"][number]) => ({
                        id: n.id,
                        type: n.type,
                        position: n.position,
                        data: { ...n.data, onDeleteNode: (delId: string) => handleDeleteNode(delId) },
                      }))
                    );
                    setEdges(
                      newGraph.edges.map((edge: PipelineGraph["edges"][number]) => ({
                        id: edge.id,
                        source: edge.source,
                        target: edge.target,
                        sourceHandle: edge.sourceHandle ?? undefined,
                        targetHandle: edge.targetHandle ?? undefined,
                        label: edge.label,
                        type: "smoothstep",
                        style: { stroke: "#78716c", strokeWidth: 2 },
                        markerEnd: { type: MarkerType.ArrowClosed, color: "#78716c" },
                        data: {
                          onDelete: (edgeId: string) => handleDeleteEdge(edgeId),
                        },
                      }))
                    );
                    router.refresh();
                  }
                } finally {
                  setSaving(false);
                }
              }
            }}
            className="field min-h-11 py-1.5 text-xs font-medium"
            disabled={saving}
          >
            <option value="FLORIST_DECOR">Preset: Florist &amp; Dekorasi</option>
            <option value="GENERIC_COMMERCE">Preset: UMKM Umum</option>
            <option value="PERSONAL_ASSISTANT">Preset: Asisten Pribadi</option>
          </select>

          <button
            type="button"
            onClick={handleSavePipeline}
            disabled={saving}
            className="btn btn-primary min-h-11 px-5 text-xs font-bold cursor-pointer"
          >
            {saving ? "Menyimpan..." : "Simpan & Terapkan"}
          </button>
        </div>
      </header>

      {/* Notifications */}
      {message && (
        <div
          role="alert"
          className={`rounded border px-4 py-3 text-xs leading-5 sm:text-sm ${
            message.type === "success"
              ? "border-[#c7d5ad] bg-[var(--success-soft)] text-[var(--success)]"
              : "border-[#e7c3be] bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 2. Interactive Flow Canvas with Overlay Panel */}
      <section className="relative overflow-hidden rounded-xl border border-[#d8d0c0] bg-[#f4f0e6] shadow-sm">
        <div className="h-[640px] w-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={true}
            nodesConnectable={true}
            elementsSelectable={true}
            deleteKeyCode={["Backspace", "Delete"]}
            edgesFocusable={true}
            edgesReconnectable={true}
            fitView
            minZoom={0.3}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color="#d8d0c0" />
            <Controls className="!bg-[#fffdf8] !border-[#d8d0c0] !rounded-md" />
            <MiniMap
              nodeColor="#9a3412"
              maskColor="#f4f0e6aa"
              className="!bg-[#fffdf8] !border-[#d8d0c0] !rounded-md"
            />

            {/* Canvas Toolbar Panel */}
            <Panel position="top-left" className="m-4 flex items-center gap-2 z-10">
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-3.5 py-2 bg-[#fffdf8] hover:bg-stone-100 text-stone-900 border border-stone-300 rounded shadow-sm text-sm font-medium transition-colors cursor-pointer"
              >
                <span className="text-base font-bold text-[#9a3412]">+</span> Tambah Kontainer
              </button>
              <button
                type="button"
                onClick={handleResetLayout}
                className="px-3 py-2 bg-[#fffdf8] hover:bg-stone-100 text-stone-700 border border-stone-300 rounded shadow-sm text-sm transition-colors cursor-pointer"
              >
                Rapikan Tata Letak
              </button>
            </Panel>
          </ReactFlow>
        </div>

        {/* Floating Canvas Hint */}
        <div className="pointer-events-none absolute right-4 top-4 rounded bg-[#fffdf8bb] px-2.5 py-1 font-mono text-[11px] text-neutral-600 backdrop-blur-xs">
          Tarik kabel antar-port · Klik kartu node untuk membuka Panel Inspektor
        </div>
      </section>

      {/* 3. Bottom Simulator Bar (Execute Workflow Style) */}
      <section className="rounded-xl border border-[#d8d0c0] bg-[#fffdf8] p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#9a3412] text-xs font-bold text-white">
              ▶
            </span>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--ink)]">
                Uji Alur Kerja (Execute Workflow Simulator)
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                Jalankan simulasi pengiriman pesan untuk melihat jalur kabel dan node yang menyala.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Peran Pengirim"
              value={simRole}
              onChange={(e) => setSimRole(e.target.value as "CUSTOMER" | "OWNER")}
              className="field min-h-9 py-1 text-xs font-mono"
            >
              <option value="CUSTOMER">Pelanggan</option>
              <option value="OWNER">Owner / Admin</option>
            </select>

            <select
              aria-label="Status Sesi"
              value={simState}
              onChange={(e) => setSimState(e.target.value as typeof simState)}
              className="field min-h-9 py-1 text-xs font-mono"
            >
              <option value="INIT">State: INIT</option>
              <option value="AWAITING_CHOICE">State: AWAITING_CHOICE</option>
              <option value="AWAITING_ORDER">State: AWAITING_ORDER</option>
              <option value="PAUSED_FOR_OWNER">State: PAUSED_FOR_OWNER</option>
              <option value="ACTIVE">State: ACTIVE</option>
            </select>

            <input
              type="text"
              value={simInput}
              onChange={(e) => setSimInput(e.target.value)}
              placeholder="Ketik pesan uji, e.g. '1', 'Halo', '2'..."
              className="field min-h-9 min-w-[200px] text-xs font-mono"
            />

            <button
              type="button"
              onClick={handleRunSimulation}
              className="btn btn-primary min-h-9 px-3 text-xs font-bold cursor-pointer"
            >
              Jalankan Simulasi
            </button>
          </div>
        </div>

        {/* Simulation Execution Report */}
        {simResult && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[#d8d0c0] pt-3 md:grid-cols-2">
            <div className="rounded bg-[#f4f0e6] p-3 text-xs">
              <span className="font-mono text-[10px] font-bold text-[#9a3412]">LOG EKSEKUSI:</span>
              <ul className="mt-1 list-disc pl-4 text-neutral-700 space-y-0.5">
                {simResult.logs.map((log, idx) => (
                  <li key={idx}>{log}</li>
                ))}
              </ul>
              <div className="mt-2 font-mono text-[11px] text-neutral-600">
                Node dilalui: <span className="font-bold text-[#1c1917]">{simResult.visited.join(" → ")}</span>
              </div>
            </div>

            <div className="rounded bg-[#075e54] p-3 text-white">
              <span className="font-mono text-[10px] font-bold text-emerald-200">BALASAN WHATSAPP:</span>
              <div className="mt-1 flex flex-col gap-2">
                {simResult.replies.map((reply, idx) => (
                  <div key={idx} className="rounded bg-white p-2 text-xs text-neutral-900 whitespace-pre-wrap">
                    <WhatsAppFormattedText text={reply} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 4. Backdrop Overlay with Blur (Depth of Field) */}
      {isInspectorOpen && (
        <div
          onClick={() => setIsInspectorOpen(false)}
          className="fixed inset-0 bg-stone-950/40 backdrop-blur-[3px] z-40 transition-opacity duration-300 animate-in fade-in"
        />
      )}

      {/* 5. Slide-Over Inspector Drawer */}
      {isInspectorOpen && selectedNode && (
        <aside
          aria-label="Panel Inspektor Kontainer"
          className="fixed top-0 right-0 h-full w-[460px] max-w-[90vw] bg-[#fffdf8] border-l border-stone-200 shadow-2xl z-50 transform transition-transform duration-300 ease-out animate-in slide-in-from-right flex flex-col"
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-[#e7e0d0] p-4 bg-[#f4f0e6]">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="badge badge-accent text-[10px] font-mono">
                  {selectedNode.type}
                </span>
                <span className="text-[11px] font-mono text-neutral-400">
                  {selectedNode.id}
                </span>
              </div>
              <h3 className="mt-1 text-sm font-bold text-[#1c1917]">
                {String(selectedData.label || selectedNode.type)}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsInspectorOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-200 text-neutral-600 text-sm font-bold cursor-pointer"
              aria-label="Tutup Inspektor"
            >
              x
            </button>
          </div>

          {/* Drawer Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5 text-xs">
            {/* Visual Process Flow Diagram */}
            <div className="rounded-lg border border-[#e7e0d0] bg-[#fdfcf9] p-3">
              <span className="font-mono text-[10px] uppercase font-bold text-[#9a3412]">
                Alur Eksekusi Proses:
              </span>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-700 font-mono">
                {processFlowExplanation}
              </p>
            </div>

            {/* Label input */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-neutral-800">Nama / Label Kontainer</label>
              <input
                type="text"
                value={String(selectedData.label || "")}
                onChange={(e) => updateSelectedNodeData({ label: e.target.value })}
                className="field text-xs"
              />
            </div>

            {/* Connected Cables Section */}
            <div className="rounded-lg border border-[#e7e0d0] bg-[#fdfcf9] p-3 text-xs flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase font-bold text-neutral-700">
                  Koneksi Kabel Terhubung ({connectedEdges.length})
                </span>
              </div>

              {connectedEdges.length === 0 ? (
                <p className="text-[11px] text-neutral-400 italic">
                  Belum ada kabel yang terhubung ke kontainer ini.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {connectedEdges.map((edge) => {
                    const isSource = edge.source === selectedNode.id;
                    const otherNodeId = isSource ? edge.target : edge.source;
                    const otherNode = nodes.find((n) => n.id === otherNodeId);
                    const otherLabel =
                      (otherNode?.data?.label as string) || otherNode?.type || otherNodeId;
                    const portName = isSource
                      ? edge.sourceHandle || "out"
                      : edge.targetHandle || "in";

                    return (
                      <div
                        key={edge.id}
                        className="flex items-center justify-between rounded border border-[#e7e0d0] bg-[#fffdf8] px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="flex items-center gap-1.5 truncate pr-2">
                          <span
                            className={`font-mono text-[10px] font-bold ${
                              isSource ? "text-amber-800" : "text-sky-800"
                            }`}
                          >
                            {isSource ? "Ke:" : "Dari:"}
                          </span>
                          <span className="truncate font-medium text-neutral-800">
                            {otherLabel}
                          </span>
                          <span className="font-mono text-[10px] text-neutral-400">
                            ({portName})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteEdge(edge.id)}
                          className="shrink-0 cursor-pointer rounded bg-stone-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-stone-600 transition-colors hover:bg-red-100 hover:text-red-700"
                        >
                          Putuskan
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Container Type Specific Parameters */}
            {selectedNode.type === "TRIGGER_INBOUND" && (
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedData.allow_unregistered_customers !== false)}
                    onChange={(e) => updateSelectedNodeData({ allow_unregistered_customers: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded text-[#9a3412]"
                  />
                  <div>
                    <span className="font-semibold text-neutral-800">Izinkan Pelanggan Publik</span>
                    <p className="text-[11px] text-neutral-500">Nomor non-owner dilayani oleh menu pelanggan.</p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedData.mute_bot_on_active_order !== false)}
                    onChange={(e) => updateSelectedNodeData({ mute_bot_on_active_order: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded text-[#9a3412]"
                  />
                  <div>
                    <span className="font-semibold text-neutral-800">Mute Saat Order Aktif</span>
                    <p className="text-[11px] text-neutral-500">Bot diam jika pelanggan memiliki order PENDING/IN_PROGRESS.</p>
                  </div>
                </label>

                {Boolean(selectedData.mute_bot_on_active_order !== false) && (
                  <div className="flex flex-col gap-1 pl-6">
                    <label className="text-xs font-semibold text-neutral-800">Batas Waktu Mute (Jam)</label>
                    <input
                      type="number"
                      min={1}
                      max={336}
                      value={Number(selectedData.mute_max_hours || 48)}
                      onChange={(e) => updateSelectedNodeData({ mute_max_hours: parseInt(e.target.value, 10) || 48 })}
                      className="field max-w-28 text-xs font-mono"
                    />
                    <p className="text-[10px] text-neutral-500">Maksimal jam bot diam saat order aktif sebelum mengirim opsi menu (default 48 jam).</p>
                  </div>
                )}

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedData.ignore_groups !== false)}
                    onChange={(e) => updateSelectedNodeData({ ignore_groups: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded text-[#9a3412]"
                  />
                  <div>
                    <span className="font-semibold text-neutral-800">Abaikan Pesan WhatsApp Grup</span>
                    <p className="text-[11px] text-neutral-500">Pesan dari grup WhatsApp diabaikan secara diam-diam.</p>
                  </div>
                </label>

                <div className="flex flex-col gap-1.5 pt-1">
                  <label className="text-xs font-semibold text-neutral-800">Rate Limit per Menit</label>
                  <input
                    type="number"
                    min={3}
                    max={100}
                    value={Number(selectedData.rate_limit_per_minute || 20)}
                    onChange={(e) => updateSelectedNodeData({ rate_limit_per_minute: parseInt(e.target.value, 10) || 20 })}
                    className="field max-w-28 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {selectedNode.type === "MESSAGE_MENU" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-neutral-800">Teks Sapaan &amp; Menu T1</label>
                  <span className="text-[10px] text-neutral-400 font-mono">WhatsApp Text</span>
                </div>
                <AutoExpandingTextarea
                  value={String(selectedData.message_text || selectedData.greeting_text || "")}
                  onChange={(val) => updateSelectedNodeData({ message_text: val, greeting_text: val })}
                  placeholder="Ketik template pesan sapaan..."
                />
              </div>
            )}

            {/* Dynamic Branch Router with Auto-Spawning & Sequential Re-Indexing */}
            {selectedNode.type === "CONDITION_ROUTER" && (() => {
              const currentBranches: CustomBranchItem[] =
                Array.isArray(selectedData.branches) && selectedData.branches.length > 0
                  ? (selectedData.branches as CustomBranchItem[])
                  : [
                      { id: "branch_1", label: "Pilihan 1 (Order)", keywords: (selectedData.branch_1_keywords as string[]) || ["1", "pesan", "order", "beli"] },
                      { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: (selectedData.branch_2_keywords as string[]) || ["2", "tanya", "konsultasi", "info"] },
                      { id: "branch_3", label: "Cabang 3 (Kustom)", keywords: (selectedData.branch_custom_keywords as string[]) || [] },
                    ];
              const handleBranchLabelChange = (bIdx: number, newLabel: string) => {
                const updatedRaw = currentBranches.map((b, i) =>
                  i === bIdx ? { ...b, label: newLabel } : b
                );

                const branchId = currentBranches[bIdx]?.id;
                const updatedEdges = edges.map((edge) => {
                  if (edge.source === selectedNode.id && edge.sourceHandle === branchId) {
                    return {
                      ...edge,
                      label: newLabel ? `Pilihan · ${newLabel}` : "Cabang Kustom",
                    };
                  }
                  return edge;
                });

                setEdges(updatedEdges);
                updateSelectedNodeData({
                  branches: updatedRaw,
                });
              };

              const handleBranchInputChange = (bIdx: number, rawValue: string) => {
                const extractedKeywords = rawValue
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);

                const updatedRaw = currentBranches.map((b, i) =>
                  i === bIdx ? { ...b, raw_input: rawValue, keywords: extractedKeywords } : b
                );

                const { normalizedBranches, updatedEdges } = normalizeCustomBranches(
                  updatedRaw,
                  edges,
                  selectedNode.id
                );

                setEdges(updatedEdges);
                updateSelectedNodeData({
                  branches: normalizedBranches,
                  branch_1_keywords: normalizedBranches.find((b) => b.id === "branch_1")?.keywords || [],
                  branch_2_keywords: normalizedBranches.find((b) => b.id === "branch_2")?.keywords || [],
                  branch_custom_keywords: normalizedBranches.find((b) => b.id === "branch_3")?.keywords || [],
                });
              };

              const handleRemoveBranch = (branchId: string) => {
                if (branchId === "branch_1" || branchId === "branch_2") return;
                const filtered = currentBranches.filter((b) => b.id !== branchId);

                const { normalizedBranches, updatedEdges } = normalizeCustomBranches(
                  filtered,
                  edges,
                  selectedNode.id
                );

                setEdges(updatedEdges);
                updateSelectedNodeData({
                  branches: normalizedBranches,
                  branch_1_keywords: normalizedBranches.find((b) => b.id === "branch_1")?.keywords || [],
                  branch_2_keywords: normalizedBranches.find((b) => b.id === "branch_2")?.keywords || [],
                  branch_custom_keywords: normalizedBranches.find((b) => b.id === "branch_3")?.keywords || [],
                });
              };

              return (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-800">Daftar Cabang Kata Kunci</span>
                    <span className="text-[10px] text-neutral-500 font-mono">Bebas ketik koma/spasi</span>
                  </div>

                  {currentBranches.map((branch, bIdx) => {
                    const isCustom = bIdx >= 2;
                    const displayValue =
                      branch.raw_input !== undefined
                        ? branch.raw_input
                        : branch.keywords.join(", ");

                    return (
                      <div
                        key={branch.id}
                        className="flex flex-col gap-1.5 rounded border border-[#e7e0d0] bg-[#fdfcf9] p-2.5"
                      >
                        <div className="flex items-center gap-2">
                          {/* Kolom 1 (35%): Label Cabang */}
                          <div className="w-[36%] shrink-0">
                            <label className="text-[10px] font-mono text-neutral-500 uppercase font-semibold block mb-0.5">
                              Label Port
                            </label>
                            <input
                              type="text"
                              value={branch.label}
                              onChange={(e) => handleBranchLabelChange(bIdx, e.target.value)}
                              placeholder={`Pilihan ${bIdx + 1}`}
                              className="field text-xs font-medium w-full text-stone-800"
                            />
                          </div>

                          {/* Kolom 2 (65%): Kata Kunci */}
                          <div className="flex-1 min-w-0">
                            <label className="text-[10px] font-mono text-neutral-500 uppercase font-semibold block mb-0.5">
                              Kata Kunci
                            </label>
                            <input
                              type="text"
                              value={displayValue}
                              onChange={(e) => handleBranchInputChange(bIdx, e.target.value)}
                              placeholder="contoh: 3, katalog, menu"
                              className="field text-xs font-mono w-full"
                            />
                          </div>

                          {/* Tombol Hapus Cabang Kustom */}
                          {isCustom ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveBranch(branch.id)}
                              className="mt-4 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded bg-stone-100 text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors font-bold"
                              title="Hapus cabang kustom ini"
                              aria-label="Hapus cabang kustom"
                            >
                              ✕
                            </button>
                          ) : (
                            <div className="w-6 shrink-0" />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex flex-col gap-1 pt-1">
                    <label className="text-xs font-semibold text-neutral-800">Teks Balasan Tidak Dikenali (Fallback)</label>
                    <AutoExpandingTextarea
                      rows={2}
                      value={String(selectedData.fallback_reply_text || "")}
                      onChange={(val) => updateSelectedNodeData({ fallback_reply_text: val })}
                      placeholder="Pesan pengingat pilihan..."
                    />
                  </div>
                </div>
              );
            })()}

            {selectedNode.type === "ORDER_FORM_PROCESSOR" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-neutral-800">Format Formulir Kosong (T2)</label>
                  <AutoExpandingTextarea
                    rows={6}
                    value={String(selectedData.form_template_text || "")}
                    onChange={(val) => updateSelectedNodeData({ form_template_text: val })}
                    placeholder="Format formulir pesanan..."
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-neutral-800">Field Wajib Diisi</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ALL_ORDER_FIELDS.map((f) => {
                      const cur = Array.isArray(selectedData.required_fields) ? (selectedData.required_fields as string[]) : [];
                      const checked = cur.includes(f.key);
                      return (
                        <label key={f.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked ? [...cur, f.key] : cur.filter((x) => x !== f.key);
                              updateSelectedNodeData({ required_fields: next });
                            }}
                            className="rounded border-neutral-300 text-[#9a3412]"
                          />
                          <span>{f.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {selectedNode.type === "CS_HANDOVER" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-neutral-800">Pesan Jeda Pelanggan (T3)</label>
                  <AutoExpandingTextarea
                    rows={3}
                    value={String(selectedData.handover_customer_text || "")}
                    onChange={(val) => updateSelectedNodeData({ handover_customer_text: val })}
                    placeholder="Pesan jeda bot..."
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-neutral-800">Template Alert ke Owner (T7)</label>
                  <AutoExpandingTextarea
                    rows={4}
                    value={String(selectedData.owner_handover_alert_template || "")}
                    onChange={(val) => updateSelectedNodeData({ owner_handover_alert_template: val })}
                    placeholder="Pesan notifikasi ke owner..."
                  />
                </div>
              </div>
            )}

            {selectedNode.type === "ORDER_FULFILLMENT" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-neutral-800">Template Konfirmasi Klien (T4)</label>
                  <AutoExpandingTextarea
                    rows={5}
                    value={String(selectedData.customer_confirmation_template || "")}
                    onChange={(val) => updateSelectedNodeData({ customer_confirmation_template: val })}
                    placeholder="Template konfirmasi pesanan..."
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-neutral-800">Template Alert Owner Pesanan Baru</label>
                  <AutoExpandingTextarea
                    rows={5}
                    value={String(selectedData.owner_new_order_alert_template || "")}
                    onChange={(val) => updateSelectedNodeData({ owner_new_order_alert_template: val })}
                    placeholder="Pesan alert pesanan baru..."
                  />
                </div>
              </div>
            )}

            {selectedNode.type === "CUSTOM_WA_REPLY" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-neutral-800">Tujuan Pengiriman</label>
                  <select
                    value={String(selectedData.recipient_type || "CUSTOMER")}
                    onChange={(e) => updateSelectedNodeData({ recipient_type: e.target.value })}
                    className="field text-xs font-mono"
                  >
                    <option value="CUSTOMER">Kirim ke Pelanggan</option>
                    <option value="PRIMARY_OWNER">Kirim ke Owner Utama</option>
                    <option value="CUSTOM_NUMBER">Nomor Khusus</option>
                  </select>
                </div>

                {selectedData.recipient_type === "CUSTOM_NUMBER" && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-neutral-800">Nomor WhatsApp Tujuan</label>
                    <input
                      type="text"
                      placeholder="+628..."
                      value={String(selectedData.custom_phone || "")}
                      onChange={(e) => updateSelectedNodeData({ custom_phone: e.target.value })}
                      className="field text-xs font-mono"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-neutral-800">Template Pesan WhatsApp</label>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {["customer_name", "order_id", "service_type", "event_date"].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          const cur = String(selectedData.message_template || "");
                          updateSelectedNodeData({ message_template: `${cur} {{${v}}}` });
                        }}
                        className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-mono text-neutral-700 hover:bg-neutral-300 cursor-pointer"
                      >
                        + {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                  <AutoExpandingTextarea
                    rows={4}
                    value={String(selectedData.message_template || "")}
                    onChange={(val) => updateSelectedNodeData({ message_template: val })}
                    placeholder="Ketik template pesan kustom..."
                  />
                </div>
              </div>
            )}

            {/* Live WhatsApp Bubble Preview with Markdown Formatter */}
            <div className="pt-2">
              <span className="font-mono text-[10px] uppercase font-bold text-neutral-500">
                Live WhatsApp Preview (Markdown Formatted):
              </span>
              <div className="mt-1 overflow-hidden rounded-lg border border-neutral-300 bg-[#efeae2] p-3 shadow-xs">
                <div className="rounded-lg rounded-tl-none bg-white p-3 text-xs text-neutral-900 shadow-xs leading-relaxed">
                  <WhatsAppFormattedText
                    text={renderPipelineTemplate(rawPreviewText, PREVIEW_DUMMY_VARS)}
                  />
                  <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-neutral-400 font-mono">
                    <span>14:02</span>
                    <span className="text-emerald-500 font-bold">vv</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Drawer Actions */}
          <div className="flex items-center justify-between border-t border-[#e7e0d0] p-4 bg-[#f4f0e6]">
            {isCustomNode ? (
              <button
                type="button"
                onClick={() => handleDeleteNode(selectedNode.id)}
                className="btn btn-quiet text-red-600 text-xs cursor-pointer"
              >
                Hapus Node
              </button>
            ) : (
              <span />
            )}

            <button
              type="button"
              onClick={() => {
                setIsInspectorOpen(false);
              }}
              className="btn btn-primary min-h-11 px-4 text-xs font-semibold cursor-pointer"
            >
              Terapkan Perubahan ke Node
            </button>
          </div>
        </aside>
      )}

      {/* Modal Tambah Kontainer Modular (Full 8 Container Catalog with Singleton Trigger) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-xl border border-[#d8d0c0] bg-[#fffdf8] p-5 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#d8d0c0] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#1c1917]">Katalog Kontainer Modular (8 Modul)</h3>
                <p className="mt-0.5 text-xs text-neutral-600">
                  Pilih modul untuk ditambahkan ke kanvas alur kerja visual:
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-neutral-500 hover:text-neutral-800 text-sm font-bold cursor-pointer p-1"
                aria-label="Tutup Katalog"
              >
                x
              </button>
            </div>

            <div className="mt-3 flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
              {CATALOG_ITEMS.map((item) => {
                const isTriggerSingleton = item.type === "TRIGGER_INBOUND" && hasTriggerInbound;

                return (
                  <button
                    key={item.type}
                    type="button"
                    disabled={isTriggerSingleton}
                    onClick={() => handleAddNode(item.type)}
                    className={`flex items-start justify-between rounded-lg border p-3 text-left transition-all ${
                      isTriggerSingleton
                        ? "border-neutral-200 bg-neutral-100 opacity-60 cursor-not-allowed"
                        : `${item.borderClass} ${item.bgClass} cursor-pointer shadow-xs hover:shadow-sm`
                    }`}
                  >
                    <div className="flex flex-col gap-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${item.badgeBg}`}>
                          {item.badge}
                        </span>
                        <h4 className={`text-xs font-bold ${item.textClass}`}>{item.title}</h4>
                      </div>
                      <p className="text-[11px] leading-relaxed text-neutral-600">{item.desc}</p>
                    </div>

                    <div className="shrink-0 pt-0.5">
                      {isTriggerSingleton ? (
                        <span className="badge badge-neutral text-[10px]">Sudah Terpasang · Maks 1</span>
                      ) : (
                        <span className="font-mono text-xs font-bold text-[#9a3412]">+ Tambah</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
