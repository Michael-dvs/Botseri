-- Clean up any invalid rows defensively
DELETE FROM "authorized_numbers" WHERE "phone_e164" IS NULL OR "phone_e164" = '';

-- AlterTable
ALTER TABLE "authorized_numbers" ALTER COLUMN "phone_e164" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "authorized_numbers_phone_e164_key" ON "authorized_numbers"("phone_e164");

-- Check constraint for E.164 format: + followed by 7 to 15 digits starting with 1-9
ALTER TABLE "authorized_numbers" ADD CONSTRAINT "authorized_numbers_phone_e164_format_check" CHECK ("phone_e164" ~ '^\+[1-9][0-9]{6,14}$');
