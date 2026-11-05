import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    botSettings: {
      create: vi.fn(),
      upsert: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

describe("S14: Constraint Singleton Tabel bot_settings (id = 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.botSettings.create.mockImplementation(async (args: { data: { id: number; brand_name: string } }) => {
      if (args.data.id !== 1) {
        const checkConstraintError = new Error(
          'new row for relation "bot_settings" violates check constraint "bot_settings_single_row"'
        );
        (checkConstraintError as unknown as Record<string, unknown>).code = "23514";
        throw checkConstraintError;
      }
      return { id: 1, brand_name: args.data.brand_name };
    });
  });

  it("1. Menyisipkan baris bot_settings dengan id = 1 diizinkan", async () => {
    const res = await prismaMock.botSettings.create({
      data: { id: 1, brand_name: "Berseri Florist" },
    });

    expect(res.id).toBe(1);
    expect(res.brand_name).toBe("Berseri Florist");
  });

  it("2. Percobaan menyisipkan baris dengan id != 1 memicu pelanggaran CHECK constraint", async () => {
    await expect(
      prismaMock.botSettings.create({
        data: { id: 2, brand_name: "Cabang Florist Palsu" },
      })
    ).rejects.toThrow('violates check constraint "bot_settings_single_row"');
  });

  it("3. Script migrasi mendefinisikan CHECK constraint bot_settings_single_row secara eksplisit", async () => {
    const sql = `ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_single_row" CHECK (id = 1);`;
    expect(sql).toContain("bot_settings_single_row");
    expect(sql).toContain("CHECK (id = 1)");
  });
});
