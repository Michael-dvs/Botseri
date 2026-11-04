-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "status" "OrderStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "orders" ADD COLUMN "completed_at" TIMESTAMPTZ;

-- Backfill: jika ada pesanan lama yang memuat [STATUS: SELESAI], tandai sebagai COMPLETED
UPDATE "orders"
SET "status" = 'COMPLETED',
    "completed_at" = "updated_at"
WHERE "notes" LIKE '%[STATUS: SELESAI]%';

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_customer_contact_idx" ON "orders"("customer_contact");
