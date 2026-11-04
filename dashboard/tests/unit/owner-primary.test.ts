import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrimaryOwner } from "@/lib/owner/primary";

const {
  prismaMock,
  recordEventMock,
} = vi.hoisted(() => ({
  prismaMock: {
    authorizedNumber: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  recordEventMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

describe("S10: Canonical getPrimaryOwner Specification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordEventMock.mockResolvedValue({});
  });

  it("1. Mengambil nomor owner yang ditandai is_primary = true secara langsung", async () => {
    const existingPrimary = {
      id: "owner-1",
      phone_e164: "+628123456789",
      chat_id: "628123456789@c.us",
      is_owner: true,
      is_primary: true,
      created_at: new Date("2026-10-01T00:00:00Z"),
    };

    prismaMock.authorizedNumber.findFirst.mockResolvedValueOnce(existingPrimary);

    const owner = await getPrimaryOwner();
    expect(owner).toEqual(existingPrimary);
    expect(prismaMock.authorizedNumber.update).not.toHaveBeenCalled();
  });

  it("2. Auto-heal: jika belum ada is_primary, ambil owner tertua dan jadikan primary secara atomik", async () => {
    // findFirst pertama (is_primary: true) mengembalikan null
    prismaMock.authorizedNumber.findFirst.mockResolvedValueOnce(null);

    const oldestOwner = {
      id: "owner-oldest",
      phone_e164: "+628999999999",
      chat_id: "628999999999@c.us",
      is_owner: true,
      is_primary: false,
      created_at: new Date("2026-09-01T00:00:00Z"),
    };

    // findFirst kedua (order by created_at asc) mengembalikan oldestOwner
    prismaMock.authorizedNumber.findFirst.mockResolvedValueOnce(oldestOwner);

    prismaMock.authorizedNumber.update.mockResolvedValueOnce({
      ...oldestOwner,
      is_primary: true,
    });

    const owner = await getPrimaryOwner();

    expect(owner?.is_primary).toBe(true);
    expect(prismaMock.authorizedNumber.update).toHaveBeenCalledWith({
      where: { id: "owner-oldest" },
      data: { is_primary: true },
    });
    expect(recordEventMock).toHaveBeenCalledWith(
      "INFO",
      "OWNER_PRIMARY",
      "AUTO_HEAL_PRIMARY_OWNER",
      expect.objectContaining({
        owner_id: "owner-oldest",
      })
    );
  });

  it("3. Mengembalikan null jika tidak ada owner sama sekali di tabel", async () => {
    prismaMock.authorizedNumber.findFirst.mockResolvedValue(null);

    const owner = await getPrimaryOwner();
    expect(owner).toBeNull();
    expect(prismaMock.authorizedNumber.update).not.toHaveBeenCalled();
  });
});
