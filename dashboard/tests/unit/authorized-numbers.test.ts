import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getPrimaryOwner } from "@/lib/scheduler/queries";

vi.mock("@/lib/db", () => {
  return {
    prisma: {
      authorizedNumber: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

describe("Authorized Numbers & Primary Owner Selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPrimaryOwner", () => {
    it("memilih nomor dengan is_owner = true dan is_primary = true", async () => {
      const mockPrimaryOwner = {
        id: "owner-primary-uuid",
        phone_e164: "+6281234567890",
        chat_id: "6281234567890@c.us",
        is_owner: true,
        is_primary: true,
        label: "HP Utama",
        created_at: new Date("2026-10-20T00:00:00Z"),
        updated_at: new Date("2026-10-27T00:00:00Z"),
      };

      vi.mocked(prisma.authorizedNumber.findFirst).mockResolvedValueOnce(
        mockPrimaryOwner as never,
      );

      const owner = await getPrimaryOwner();

      expect(owner).toEqual(mockPrimaryOwner);
      expect(prisma.authorizedNumber.findFirst).toHaveBeenCalledWith({
        where: { is_owner: true, is_primary: true },
        orderBy: { updated_at: "desc" },
      });
    });

    it("fallback ke nomor owner yang paling terakhir diperbarui jika tidak ada is_primary", async () => {
      // Panggilan pertama untuk primary mengembalikan null
      vi.mocked(prisma.authorizedNumber.findFirst).mockResolvedValueOnce(null);

      // Panggilan kedua fallback mengembalikan nomor terbaru
      const mockFallbackOwner = {
        id: "owner-fallback-uuid",
        phone_e164: "+6289876543210",
        chat_id: "6289876543210@c.us",
        is_owner: true,
        is_primary: false,
        label: "Owner Paired",
        created_at: new Date("2026-10-22T00:00:00Z"),
        updated_at: new Date("2026-10-27T12:00:00Z"),
      };
      vi.mocked(prisma.authorizedNumber.findFirst).mockResolvedValueOnce(
        mockFallbackOwner as never,
      );

      const owner = await getPrimaryOwner();

      expect(owner).toEqual(mockFallbackOwner);
      expect(prisma.authorizedNumber.findFirst).toHaveBeenNthCalledWith(1, {
        where: { is_owner: true, is_primary: true },
        orderBy: { updated_at: "desc" },
      });
      expect(prisma.authorizedNumber.findFirst).toHaveBeenNthCalledWith(2, {
        where: { is_owner: true },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      });
    });

    it("mengembalikan null bila tidak ada nomor berstatus owner sama sekali", async () => {
      vi.mocked(prisma.authorizedNumber.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const owner = await getPrimaryOwner();
      expect(owner).toBeNull();
    });
  });
});
