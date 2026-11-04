-- CreateEnum
CREATE TYPE "CustomerSessionState" AS ENUM ('INIT', 'AWAITING_CHOICE', 'AWAITING_ORDER', 'PAUSED_FOR_OWNER', 'ACTIVE');

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_e164" VARCHAR(50) NOT NULL,
    "customer_name" VARCHAR(255),
    "state" "CustomerSessionState" NOT NULL DEFAULT 'INIT',
    "paused_at" TIMESTAMPTZ,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_phone_e164_key" ON "customer_sessions"("phone_e164");
