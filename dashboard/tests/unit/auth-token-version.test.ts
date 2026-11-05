import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  getSession,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";

const { prismaMock, cookiesMock } = vi.hoisted(() => ({
  prismaMock: {
    adminUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  cookiesMock: {
    get: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock,
}));

describe("S14: Pembatalan Sesi JWT Berbasis token_version", () => {
  const adminId = "11111111-2222-3333-4444-555555555555";
  const username = "admin";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-secret-key-for-session-at-least-32-chars";
  });

  it("1. createSessionToken menyertakan klaim token_version di payload JWT", async () => {
    const token = await createSessionToken(adminId, username, 0);
    expect(typeof token).toBe("string");

    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe(adminId);
    expect(payload?.username).toBe(username);
    expect(payload?.token_version).toBe(0);
  });

  it("2. getSession mengizinkan token saat token_version cocok dengan database", async () => {
    const token = await createSessionToken(adminId, username, 0);
    cookiesMock.get.mockReturnValue({ value: token });

    prismaMock.adminUser.findUnique.mockResolvedValueOnce({
      id: adminId,
      token_version: 0,
    });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.sub).toBe(adminId);
    expect(session?.token_version).toBe(0);
  });

  it("3. getSession menolak token lama saat token_version di database telah dinaikkan", async () => {
    // Token lama masih membawa token_version 0
    const oldToken = await createSessionToken(adminId, username, 0);
    cookiesMock.get.mockReturnValue({ value: oldToken });

    // Database sudah naik ke token_version 1 (misal pasca-logout atau pencabutan sesi)
    prismaMock.adminUser.findUnique.mockResolvedValueOnce({
      id: adminId,
      token_version: 1,
    });

    const session = await getSession();
    expect(session).toBeNull();
  });

  it("4. Token baru dengan token_version terkini berhasil divalidasi", async () => {
    // Token baru diterbitkan dengan token_version 1
    const newToken = await createSessionToken(adminId, username, 1);
    cookiesMock.get.mockReturnValue({ value: newToken });

    prismaMock.adminUser.findUnique.mockResolvedValueOnce({
      id: adminId,
      token_version: 1,
    });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.sub).toBe(adminId);
    expect(session?.token_version).toBe(1);
  });

  it("5. Endpoint logout menaikkan token_version user secara atomik di database", async () => {
    const activeToken = await createSessionToken(adminId, username, 0);
    cookiesMock.get.mockReturnValue({ value: activeToken });

    prismaMock.adminUser.findUnique.mockResolvedValueOnce({
      id: adminId,
      token_version: 0,
    });
    prismaMock.adminUser.update.mockResolvedValueOnce({
      id: adminId,
      token_version: 1,
    });

    const req = new Request("http://localhost:3000/api/auth/logout", {
      method: "POST",
    });

    const res = await logoutPOST(req);
    expect(res.status).toBe(200);

    // Verifikasi increment token_version dipanggil
    expect(prismaMock.adminUser.update).toHaveBeenCalledWith({
      where: { id: adminId },
      data: { token_version: { increment: 1 } },
    });

    // Verifikasi cookie sesi dibersihkan
    const cookieHeader = res.headers.get("set-cookie");
    expect(cookieHeader).toContain(`${SESSION_COOKIE}=;`);
  });
});
