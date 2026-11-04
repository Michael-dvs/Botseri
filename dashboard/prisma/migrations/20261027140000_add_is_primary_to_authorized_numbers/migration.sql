-- AlterTable
ALTER TABLE "authorized_numbers" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "authorized_numbers" ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: Jika ada nomor owner, tandai satu nomor owner sebagai is_primary = true
UPDATE "authorized_numbers"
SET "is_primary" = true
WHERE "id" = (
  SELECT "id" FROM "authorized_numbers"
  WHERE "is_owner" = true
  ORDER BY "created_at" ASC
  LIMIT 1
);
