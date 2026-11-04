export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  is_primary: z.boolean().optional(),
  label: z.string().trim().max(100).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Format request JSON tidak valid." },
      { status: 400 },
    );
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || "Input tidak valid.";
    return NextResponse.json({ ok: false, error: errorMsg }, { status: 400 });
  }

  const { is_primary, label } = parsed.data;

  try {
    const existing = await prisma.authorizedNumber.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Nomor tidak ditemukan." },
        { status: 404 },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Jika nomor ini dijadikan primary, reset nomor lain menjadi is_primary = false
      if (is_primary === true) {
        await tx.authorizedNumber.updateMany({
          where: { id: { not: params.id } },
          data: { is_primary: false },
        });
      }

      return tx.authorizedNumber.update({
        where: { id: params.id },
        data: {
          ...(is_primary !== undefined ? { is_primary } : {}),
          ...(label !== undefined ? { label } : {}),
        },
      });
    });

    return NextResponse.json({
      ok: true,
      number: updated,
    });
  } catch (error) {
    console.error("Gagal memperbarui nomor terotorisasi:", error);
    return NextResponse.json(
      { ok: false, error: "Gagal memperbarui nomor terotorisasi." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const target = await prisma.authorizedNumber.findUnique({
      where: { id: params.id },
    });
    if (!target) {
      return NextResponse.json(
        { ok: false, error: "Nomor tidak ditemukan." },
        { status: 404 },
      );
    }

    // Cegah penghapusan jika nomor tersebut adalah satu-satunya nomor owner tersisa
    if (target.is_owner) {
      const ownerCount = await prisma.authorizedNumber.count({
        where: { is_owner: true },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { ok: false, error: "Minimal satu nomor pemilik wajib tersisa." },
          { status: 400 },
        );
      }
    }

    // Hapus nomor dan promosikan nomor owner lain jika yang dihapus adalah primary
    await prisma.$transaction(async (tx) => {
      await tx.authorizedNumber.delete({
        where: { id: params.id },
      });

      if (target.is_primary) {
        const nextOwner = await tx.authorizedNumber.findFirst({
          where: { is_owner: true },
          orderBy: { updated_at: "desc" },
        });
        if (nextOwner) {
          await tx.authorizedNumber.update({
            where: { id: nextOwner.id },
            data: { is_primary: true },
          });
        }
      }
    });

    return NextResponse.json({
      ok: true,
      deleted_id: params.id,
    });
  } catch (error) {
    console.error("Gagal menghapus nomor terotorisasi:", error);
    return NextResponse.json(
      { ok: false, error: "Gagal menghapus nomor terotorisasi." },
      { status: 500 },
    );
  }
}
