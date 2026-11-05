import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  createSessionToken,
  isSecureRequest,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { matchesSetupToken } from "@/lib/auth/setup-token";
import { clientIp, rateLimit } from "@/lib/auth/rate-limit";
import { compileSystemPrompt } from "@/lib/prompt/compiler";
import { log } from "@/lib/logger";

const schema = z.object({
  brand_name: z.string().trim().min(1).max(100),
  business_type: z.string().trim().min(1).max(100),
  owner_name: z.string().trim().min(1).max(100),
  enable_orders: z.boolean().optional().default(true),
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(12).max(128),
  setup_token: z.string().min(1),
});

function behaviorInstruction(mode: "STRICT" | "SANTAI") {
  return mode === "STRICT"
    ? "Tegas, ringkas, dan disiplin. Sindiran menyasar perilaku menunda."
    : "Santai, suportif, dan tidak menghakimi.";
}

export async function POST(request: Request) {
  if (!rateLimit(`setup:${clientIp(request)}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan" },
      { status: 429 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Data setup tidak valid", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (!matchesSetupToken(parsed.data.setup_token)) {
    return NextResponse.json({ error: "Setup token salah" }, { status: 401 });
  }

  try {
    const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return NextResponse.json(
        { error: "Pengaturan awal belum tersedia" },
        { status: 500 },
      );
    }
    if (settings.setup_completed) {
      return NextResponse.json(
        { error: "Setup sudah selesai" },
        { status: 409 },
      );
    }

    const levels = await prisma.priorityLevel.findMany();
    const nextSettings = {
      ...settings,
      brand_name: parsed.data.brand_name,
      business_type: parsed.data.business_type,
      owner_name: parsed.data.owner_name,
      enable_orders: parsed.data.enable_orders,
      behavior_instruction: behaviorInstruction(settings.behavior_mode),
      setup_completed: true,
    };
    const compiled = compileSystemPrompt(nextSettings, levels);
    const passwordHash = await hashPassword(parsed.data.password);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.adminUser.findFirst();
      const admin = existing
        ? await tx.adminUser.update({
            where: { id: existing.id },
            data: { username: parsed.data.username, password_hash: passwordHash },
          })
        : await tx.adminUser.create({
            data: {
              username: parsed.data.username,
              password_hash: passwordHash,
            },
          });

      const updated = await tx.botSettings.update({
        where: { id: 1 },
        data: {
          brand_name: parsed.data.brand_name,
          business_type: parsed.data.business_type,
          owner_name: parsed.data.owner_name,
          enable_orders: parsed.data.enable_orders,
          behavior_instruction: nextSettings.behavior_instruction,
          setup_completed: true,
          compiled_prompt: compiled.prompt,
          compiled_prompt_version: compiled.version,
          compiled_at: new Date(),
        },
      });

      await tx.systemEvent.create({
        data: {
          level: "INFO",
          source: "setup",
          code: "setup.completed",
          message: "Setup selesai",
          context: { warnings: compiled.warnings },
        },
      });

      return { admin, updated };
    });

    const token = await createSessionToken(result.admin.id, result.admin.username, result.admin.token_version ?? 0);
    const response = NextResponse.json({
      ok: true,
      setup_completed: true,
      compiled_prompt_version: result.updated.compiled_prompt_version,
    });
    response.cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(isSecureRequest(request)),
    );
    return response;
  } catch (error) {
    log("ERROR", "setup", "setup failed", undefined, error);
    return NextResponse.json(
      { error: "Setup gagal diproses" },
      { status: 500 },
    );
  }
}
