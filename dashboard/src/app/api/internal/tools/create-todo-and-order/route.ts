export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeInternal } from "@/lib/internal/auth";
import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { formatDueAtLocalText, localDateString, localIsoString, normalizeIsoDateTime, resolveTimeExpression } from "@/lib/time";
import { syncTodo } from "@/lib/google/sync";
import {
  createOrderForMessage,
  createTodoIdempotent,
} from "@/lib/todos/create";

function parseFlexibleDueAt(val: unknown, timezone: string): string | null {
  if (val === null || val === undefined) return null;
  const raw = String(val).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const isTomorrow = lower.includes("besok") || lower.includes("tomorrow");
  const isDayAfter = lower.includes("lusa");
  const isToday = lower.includes("hari ini") || lower.includes("today");

  if (isTomorrow || isDayAfter || isToday) {
    const now = new Date();
    const todayStr = localDateString(now, timezone);
    const anchor = new Date(`${todayStr}T00:00:00Z`);
    const offsetDays = isTomorrow ? 1 : isDayAfter ? 2 : 0;
    const targetDate = addDays(anchor, offsetDays);
    const targetDateStr = format(targetDate, "yyyy-MM-dd");

    let timeStr = "08:00:00";
    if (lower.includes("siang")) timeStr = "12:00:00";
    else if (lower.includes("sore")) timeStr = "15:00:00";
    else if (lower.includes("malam")) timeStr = "19:00:00";

    const utcDate = fromZonedTime(`${targetDateStr}T${timeStr}`, timezone);
    return localIsoString(utcDate, timezone);
  }

  return normalizeIsoDateTime(raw, timezone);
}

function parseJsonSafe(val: unknown): unknown {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

function normalizePriorityRank(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const intRank = Math.floor(raw);
    if (intRank >= 1 && intRank <= 4) return intRank;
    return 4;
  }
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9]/g, "");
    if (cleaned) {
      const parsed = parseInt(cleaned, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) {
        return parsed;
      }
    }
  }
  return 4;
}

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
    if (typeof rawBody === "string") {
      rawBody = JSON.parse(rawBody);
    }
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_JSON",
          message: "Request body harus berupa JSON yang valid",
          fields: ["body"],
        },
      },
      { status: 422 },
    );
  }

  if (!rawBody || typeof rawBody !== "object") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: "Payload harus berupa JSON object",
          fields: ["body"],
        },
      },
      { status: 422 },
    );
  }

  const raw = rawBody as Record<string, unknown>;
  const errorFields: string[] = [];
  const errorMessages: string[] = [];

  const initialSettings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  const timezone = initialSettings?.timezone ?? "Asia/Jakarta";

  // 1. source_message_id (opsional: jika diisi harus UUID valid)
  let sourceMessageId: string | null = null;
  if (raw.source_message_id !== undefined && raw.source_message_id !== null && String(raw.source_message_id).trim() !== "") {
    const strId = String(raw.source_message_id).trim();
    if (!z.string().uuid().safeParse(strId).success) {
      errorFields.push("source_message_id");
      errorMessages.push("source_message_id harus berupa UUID yang valid");
    } else {
      sourceMessageId = strId;
    }
  }
  // 2. Normalisasi todos (bisa berupa array, stringified array, objek tunggal, atau flat single-todo)
  let rawTodos: unknown[] = [];
  const candidateTodos = parseJsonSafe(raw.todos);
  if (Array.isArray(candidateTodos) && candidateTodos.length > 0) {
    rawTodos = candidateTodos;
  } else if (candidateTodos && typeof candidateTodos === "object" && "title" in candidateTodos) {
    rawTodos = [candidateTodos];
  } else if (raw.title && typeof raw.title === "string") {
    // Format flat single-todo yang dihasilkan oleh toolHttpRequest
    rawTodos = [raw];
  } else {
    errorFields.push("title");
    errorMessages.push("Minimal 1 to-do dengan 'title' wajib disertakan");
  }

  // 3. Normalisasi order (bisa berupa object, stringified object, atau flat order fields)
  let rawOrder: Record<string, unknown> | null = null;
  const candidateOrder = parseJsonSafe(raw.order);
  if (candidateOrder && typeof candidateOrder === "object" && !Array.isArray(candidateOrder)) {
    rawOrder = candidateOrder as Record<string, unknown>;
  } else if (raw.customer_name || raw.order_description) {
    // Flat order fields
    rawOrder = {
      customer_name: String(raw.customer_name ?? "Pelanggan").trim(),
      description: String(raw.order_description ?? raw.description ?? raw.title ?? "").trim(),
      delivery_date: raw.due_at ?? null,
    };
  }

  // 4. Coerce dan normalisasi setiap to-do item
  const normalizedTodos = [];
  for (let i = 0; i < rawTodos.length; i++) {
    const item = (rawTodos[i] ?? {}) as Record<string, unknown>;
    const title = String(item.title ?? "").trim();
    if (!title) {
      errorFields.push(`todos[${i}].title`);
      errorMessages.push(`To-do #${i + 1} wajib memiliki judul (title)`);
      continue;
    }

    // Coerce priority_rank secara defensif
    const rank = item.priority_rank !== undefined && item.priority_rank !== null
      ? normalizePriorityRank(item.priority_rank)
      : 1;

    // Coerce has_specific_time
    let specificTime = false;
    if (typeof item.has_specific_time === "boolean") {
      specificTime = item.has_specific_time;
    } else if (typeof item.has_specific_time === "string") {
      specificTime = item.has_specific_time.toLowerCase() === "true";
    }

    // Coerce & normalize due_at and remind_at secara fleksibel
    let normalizedDueAt: string | null = null;
    let normalizedRemindAt: string | null = null;

    if (item.remind_at !== undefined && item.remind_at !== null) {
      try {
        normalizedRemindAt = parseFlexibleDueAt(item.remind_at, timezone);
        specificTime = true;
        if (item.due_at === item.remind_at) {
          item.due_at = null;
        }
      } catch (err) {
        errorFields.push(`todos[${i}].remind_at`);
        errorMessages.push(
          `To-do #${i + 1} remind_at tidak valid: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (item.due_at !== undefined && item.due_at !== null) {
      try {
        normalizedDueAt = parseFlexibleDueAt(item.due_at, timezone);
        specificTime = true;
      } catch (err) {
        errorFields.push(`todos[${i}].due_at`);
        errorMessages.push(
          `To-do #${i + 1} due_at tidak valid: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (item.time_expression || item.daypart || item.time_kind) {
      const res = resolveTimeExpression(
        new Date(),
        timezone,
        (item.time_expression || item) as Parameters<typeof resolveTimeExpression>[2],
        typeof item.date_hint === "string" ? item.date_hint : null,
      );
      if (res.ok) {
        if (item.is_reminder || item.remind_at !== undefined) {
          normalizedRemindAt = res.due_at_iso;
        } else {
          normalizedDueAt = res.due_at_iso;
        }
        specificTime = true;
      }
    }

    normalizedTodos.push({
      title: title.slice(0, 120),
      description: item.description ? String(item.description).slice(0, 2000) : null,
      category: item.category ? String(item.category).slice(0, 40) : null,
      priority_rank: rank,
      due_at: normalizedDueAt,
      remind_at: normalizedRemindAt,
      has_specific_time: specificTime,
    });
  }

  // 5. Coerce & normalisasi order jika ada
  let normalizedOrder = null;
  if (rawOrder) {
    const custName = String(rawOrder.customer_name ?? rawOrder.item_name ?? "Pelanggan").trim() || "Pelanggan";
    const desc = String(rawOrder.description ?? rawOrder.notes ?? rawOrder.item_name ?? "Pesanan").trim() || "Pesanan";

    let deliveryDate: string | null = null;
    if (rawOrder.delivery_date !== undefined && rawOrder.delivery_date !== null) {
      try {
        deliveryDate = normalizeIsoDateTime(String(rawOrder.delivery_date));
      } catch {
        // Fallback: jangan gagalkan pesanan jika tanggal pengiriman sedikit meleset
        deliveryDate = null;
      }
    }

    let eventDate: string | null = null;
    if (rawOrder.event_date !== undefined && rawOrder.event_date !== null) {
      try {
        eventDate = normalizeIsoDateTime(String(rawOrder.event_date));
      } catch {
        eventDate = null;
      }
    }

    normalizedOrder = {
      customer_name: custName.slice(0, 150),
      customer_contact: rawOrder.customer_contact ? String(rawOrder.customer_contact).slice(0, 50) : null,
      description: desc.slice(0, 5000),
      delivery_date: deliveryDate,
      event_date: eventDate,
      delivery_address: rawOrder.delivery_address ? String(rawOrder.delivery_address).slice(0, 2000) : null,
      total_amount: rawOrder.total_amount ? Number(rawOrder.total_amount) : null,
      dp_amount: rawOrder.dp_amount ? Number(rawOrder.dp_amount) : null,
      payment_status: (rawOrder.payment_status as "UNPAID" | "DP_PAID" | "PAID") || undefined,
    };
  }

  if (errorFields.length > 0 || normalizedTodos.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: errorMessages.join("; ") || "Validasi gagal",
          fields: errorFields,
        },
      },
      { status: 422 },
    );
  }

  // Fallback source_message_id jika tidak disediakan
  if (!sourceMessageId) {
    const latestMsg = await prisma.messageLog.findFirst({
      where: { direction: "INBOUND" },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });
    if (latestMsg) {
      sourceMessageId = latestMsg.id;
    } else {
      const fallbackMsg = await prisma.messageLog.create({
        data: {
          direction: "INBOUND",
          chat_id: "system@c.us",
          body: "Direct tool execution",
        },
      });
      sourceMessageId = fallbackMsg.id;
    }
  }

  const input = {
    source_message_id: sourceMessageId,
    order: normalizedOrder,
    todos: normalizedTodos,
  };

  const [settings, levels, message] = await Promise.all([
    prisma.botSettings.findUnique({ where: { id: 1 } }),
    prisma.priorityLevel.findMany({ orderBy: { rank: "asc" } }),
    prisma.messageLog.findUnique({ where: { id: input.source_message_id } }),
  ]);

  if (!settings || levels.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FAILED",
          message: "Pengaturan atau Priority Stack belum siap",
        },
      },
      { status: 200 },
    );
  }

  if (!message) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "source_message_id tidak ditemukan",
        },
      },
      { status: 200 },
    );
  }

  const orderId = (input.order && settings.enable_orders)
    ? await createOrderForMessage(input.order, input.source_message_id)
    : null;

  const warnings: string[] = [];
  const created = [];

  for (const todoInput of input.todos) {
    const result = await createTodoIdempotent({
      input: todoInput,
      settings,
      levels,
      sourceMessageId: input.source_message_id,
      orderId,
    });
    if (result.warning) warnings.push(result.warning);
    created.push({ ...result.todo, deduplicated: result.deduplicated });
  }

  // Sinkronisasi Google untuk to-do baru yang tidak terduplikasi (terisolasi try/catch agar tidak menggagalkan response)
  for (const item of created) {
    if (!item.deduplicated) {
      try {
        await syncTodo(item.id);
      } catch (syncError) {
        console.error("syncTodo error (non-fatal):", syncError);
      }
    }
  }

  const refreshed = await prisma.todo.findMany({
    where: { id: { in: created.map((t) => t.id) } },
    include: { priority_level: true },
  });
  const byId: Record<string, (typeof refreshed)[number]> = {};
  for (const t of refreshed) {
    byId[t.id] = t;
  }

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    todos: created.map((item) => {
      const todo = byId[item.id] ?? item;
      const priorityLabel =
        "priority_level" in todo ? todo.priority_level?.label ?? null : null;
      return {
        id: todo.id,
        title: todo.title,
        priority_rank: todo.priority_rank,
        priority_label: priorityLabel,
        due_at: todo.due_at
          ? localIsoString(todo.due_at, settings.timezone)
          : null,
        due_at_local_text: todo.due_at
          ? formatDueAtLocalText(todo.due_at, settings.timezone)
          : null,
        remind_at: todo.remind_at
          ? localIsoString(todo.remind_at, settings.timezone)
          : null,
        remind_at_local_text: todo.remind_at
          ? formatDueAtLocalText(todo.remind_at, settings.timezone)
          : null,
        time_label: todo.due_at
          ? `Tenggat: ${formatDueAtLocalText(todo.due_at, settings.timezone)}`
          : todo.remind_at
            ? `Pengingat: ${formatDueAtLocalText(todo.remind_at, settings.timezone)}`
            : null,
        needs_time: !todo.has_specific_time,
        planned_date: todo.planned_date.toISOString().slice(0, 10),
        google_sync_status: todo.google_sync_status,
        deduplicated: item.deduplicated,
      };
    }),
    warnings,
  });
}
