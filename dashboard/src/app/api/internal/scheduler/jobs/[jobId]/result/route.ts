import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { checkInternalAuth } from "@/lib/internal/auth";
import { getPrimaryOwner } from "@/lib/owner/primary";

const schema = z.object({
  status: z.enum(["SENT", "FAILED"]),
  error: z.string().max(2000).optional(),
  body: z.string().max(5000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { jobId: string } },
) {
  const unauthorized = checkInternalAuth(request);
  if (unauthorized) return unauthorized;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const decodedJobId = decodeURIComponent(params.jobId);

  // Penanganan job TASK_ALARM (identitas: alarm:<todo_id>:<attempt>)
  if (decodedJobId.startsWith("alarm:")) {
    const parts = decodedJobId.split(":");
    const todoId = parts[1];
    if (!todoId || !z.string().uuid().safeParse(todoId).success) {
      return NextResponse.json({ error: "Job alarm tidak valid" }, { status: 404 });
    }

    const todo = await prisma.todo.findUnique({ where: { id: todoId } });
    if (!todo) {
      return NextResponse.json({ error: "Tugas tidak ditemukan" }, { status: 404 });
    }

    const input = parsed.data;
    if (input.status === "SENT") {
      if (!todo.reminded_at) {
        await prisma.todo.update({
          where: { id: todo.id },
          data: {
            reminded_at: new Date(),
            reminder_claimed_at: null,
          },
        });
      }

      if (input.body) {
        const owner = await getPrimaryOwner();
        if (owner) {
          const existing = await prisma.messageLog.findFirst({
            where: {
              direction: "OUTBOUND",
              chat_id: owner.chat_id,
              body: input.body,
              created_at: { gte: new Date(Date.now() - 5 * 60_000) },
            },
            select: { id: true },
          });
          if (!existing) {
            await prisma.messageLog.create({
              data: { direction: "OUTBOUND", chat_id: owner.chat_id, body: input.body },
            });
          }
        }
      }
    } else if (input.status === "FAILED") {
      await recordEvent("ERROR", "SCHEDULER", "JOB_SEND_FAILED", {
        job_id: decodedJobId,
        job_type: "TASK_ALARM",
        todo_id: todo.id,
        error: (input.error ?? "pengiriman alarm gagal").slice(0, 500),
      });
      await prisma.todo.update({
        where: { id: todo.id },
        data: {
          reminder_claimed_at: null,
        },
      });
    }

    return NextResponse.json({ ok: true, status: input.status });
  }

  const job = await prisma.dailyExecutionLog.findUnique({ where: { id: params.jobId } });
  if (!job) return NextResponse.json({ error: "Job tidak ditemukan" }, { status: 404 });
  if (job.status !== "CLAIMED") {
    return NextResponse.json({ ok: true, status: job.status });
  }

  const input = parsed.data;
  const updated = await prisma.dailyExecutionLog.updateMany({
    where: { id: job.id, status: "CLAIMED" },
    data: {
      status: input.status,
      sent_at: input.status === "SENT" ? new Date() : null,
      error: input.status === "FAILED" ? input.error ?? "pengiriman gagal" : null,
    },
  });
  if (updated.count === 0) {
    const current = await prisma.dailyExecutionLog.findUniqueOrThrow({ where: { id: job.id } });
    return NextResponse.json({ ok: true, status: current.status });
  }

  if (input.status === "SENT" && input.body) {
    const owner = await getPrimaryOwner();
    if (owner) {
      const existing = await prisma.messageLog.findFirst({
        where: {
          direction: "OUTBOUND",
          chat_id: owner.chat_id,
          body: input.body,
          created_at: { gte: job.claimed_at },
        },
        orderBy: { created_at: "desc" },
        select: { id: true },
      });
      if (!existing) {
        await prisma.messageLog.create({
          data: { direction: "OUTBOUND", chat_id: owner.chat_id, body: input.body },
        });
      }
    }
  }

  if (input.status === "FAILED") {
    await recordEvent("ERROR", "SCHEDULER", "JOB_SEND_FAILED", {
      job_id: job.id,
      job_type: job.job_type,
      seq: job.seq,
      error: (input.error ?? "pengiriman job gagal").slice(0, 500),
    });
  }

  return NextResponse.json({ ok: true, status: input.status });
}
