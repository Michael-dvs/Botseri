-- AlterTable
ALTER TABLE "customer_sessions" ADD COLUMN "blocked_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "runtime_flags" (
    "key" VARCHAR(100) NOT NULL,
    "value_json" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_flags_pkey" PRIMARY KEY ("key")
);
