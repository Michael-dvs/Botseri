-- AlterTable
ALTER TABLE "orders" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");

-- CreateTable
CREATE TABLE "pending_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_chat_id" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "preview_text" TEXT NOT NULL,
    "created_message_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "executed_at" TIMESTAMPTZ(3),

    CONSTRAINT "pending_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_confirmations_owner_chat_id_executed_at_expires_at_idx" ON "pending_confirmations"("owner_chat_id", "executed_at", "expires_at");
