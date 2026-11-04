-- AlterTable
ALTER TABLE "orders" ADD COLUMN "customer_chat_id" VARCHAR(100);

-- CreateIndex
CREATE INDEX "orders_customer_chat_id_status_idx" ON "orders"("customer_chat_id", "status");
