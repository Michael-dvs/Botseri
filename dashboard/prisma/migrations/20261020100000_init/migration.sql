-- CreateEnum
CREATE TYPE "BehaviorMode" AS ENUM ('STRICT', 'SANTAI');

-- CreateEnum
CREATE TYPE "PromptMode" AS ENUM ('STACK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoogleSyncStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "GoogleSyncMode" AS ENUM ('AUTO', 'BOTH');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('MORNING_BRIEF', 'WORK_HOURS_REMINDER', 'END_OF_DAY_EVAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('CLAIMED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EvalTier" AS ENUM ('HIGH', 'MID', 'LOW', 'NO_TASKS');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "OAuthStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'DP_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "TodoCreatedVia" AS ENUM ('CHAT', 'DASHBOARD', 'SYSTEM');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "brand_name" VARCHAR(100) NOT NULL DEFAULT '',
    "business_type" VARCHAR(100) NOT NULL DEFAULT '',
    "owner_name" VARCHAR(100) NOT NULL DEFAULT '',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta',
    "work_hours_start" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "work_hours_end" VARCHAR(5) NOT NULL DEFAULT '17:00',
    "early_brief_time" VARCHAR(5) NOT NULL DEFAULT '06:00',
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "behavior_mode" "BehaviorMode" NOT NULL DEFAULT 'STRICT',
    "behavior_instruction" TEXT,
    "prompt_mode" "PromptMode" NOT NULL DEFAULT 'STACK',
    "custom_prompt_template" TEXT,
    "compiled_prompt" TEXT,
    "compiled_prompt_version" INTEGER NOT NULL DEFAULT 1,
    "compiled_at" TIMESTAMPTZ,
    "reminder_interval_minutes" INTEGER NOT NULL DEFAULT 120,
    "reminder_max_per_day" INTEGER NOT NULL DEFAULT 5,
    "reminder_max_rank" INTEGER NOT NULL DEFAULT 2,
    "brief_window_minutes" INTEGER NOT NULL DEFAULT 120,
    "eod_window_minutes" INTEGER NOT NULL DEFAULT 120,
    "default_due_time" VARCHAR(5) NOT NULL DEFAULT '17:00',
    "google_sync_mode" "GoogleSyncMode" NOT NULL DEFAULT 'AUTO',
    "bot_enabled" BOOLEAN NOT NULL DEFAULT true,
    "setup_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rank" INTEGER NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "rule_text" TEXT NOT NULL,
    "color" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "priority_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_name" VARCHAR(150) NOT NULL,
    "customer_contact" VARCHAR(50),
    "description" TEXT NOT NULL,
    "event_date" TIMESTAMPTZ,
    "delivery_date" TIMESTAMPTZ,
    "delivery_address" TEXT,
    "total_amount" DECIMAL(14,2),
    "dp_amount" DECIMAL(14,2),
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(40),
    "status" "TodoStatus" NOT NULL DEFAULT 'PENDING',
    "priority_level_id" UUID,
    "priority_rank" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ,
    "has_specific_time" BOOLEAN NOT NULL DEFAULT false,
    "planned_date" DATE NOT NULL,
    "order_id" UUID,
    "rollover_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ,
    "source_message_id" VARCHAR(255),
    "dedupe_key" VARCHAR(64),
    "created_via" "TodoCreatedVia" NOT NULL DEFAULT 'CHAT',
    "calendar_event_id" VARCHAR(255),
    "google_task_id" VARCHAR(255),
    "google_sync_status" "GoogleSyncStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "google_sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "google_sync_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorized_numbers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" VARCHAR(100) NOT NULL,
    "phone_e164" VARCHAR(20),
    "label" VARCHAR(100),
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorized_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "direction" "MessageDirection" NOT NULL,
    "wa_message_id" VARCHAR(255),
    "chat_id" VARCHAR(100) NOT NULL,
    "body" TEXT,
    "media_type" VARCHAR(50),
    "transcript" TEXT,
    "in_reply_to" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "base_url" VARCHAR(255),
    "api_key_enc" TEXT NOT NULL,
    "stt_model" VARCHAR(100),
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "max_output_tokens" INTEGER NOT NULL DEFAULT 1000,
    "price_input_per_mtok" DECIMAL(10,4),
    "price_output_per_mtok" DECIMAL(10,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(50) NOT NULL DEFAULT 'google',
    "account_email" VARCHAR(255),
    "scopes" TEXT[],
    "client_id" VARCHAR(255),
    "client_secret_enc" TEXT,
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "expires_at" TIMESTAMPTZ,
    "status" "OAuthStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "calendar_id" VARCHAR(255) DEFAULT 'primary',
    "tasklist_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "call_type" VARCHAR(50) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6),
    "latency_ms" INTEGER,
    "n8n_execution_id" VARCHAR(100),
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,

    CONSTRAINT "llm_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_execution_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_date" DATE NOT NULL,
    "job_type" "JobType" NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL DEFAULT 'CLAIMED',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "daily_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "local_date" DATE NOT NULL,
    "target_count" INTEGER NOT NULL,
    "done_count" INTEGER NOT NULL,
    "pending_count" INTEGER NOT NULL,
    "completion_rate" DECIMAL(5,2),
    "tier" "EvalTier" NOT NULL,
    "rolled_over_count" INTEGER NOT NULL DEFAULT 0,
    "snapshot_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("local_date")
);

-- CreateTable
CREATE TABLE "holidays" (
    "date" DATE NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "system_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" VARCHAR(20) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,

    CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "priority_levels_rank_key" ON "priority_levels"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "todos_dedupe_key_key" ON "todos"("dedupe_key");

-- CreateIndex
CREATE INDEX "todos_planned_date_status_idx" ON "todos"("planned_date", "status");

-- CreateIndex
CREATE INDEX "todos_priority_rank_idx" ON "todos"("priority_rank");

-- CreateIndex
CREATE INDEX "todos_google_sync_status_google_sync_attempts_idx" ON "todos"("google_sync_status", "google_sync_attempts");

-- CreateIndex
CREATE UNIQUE INDEX "authorized_numbers_chat_id_key" ON "authorized_numbers"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_codes_code_hash_key" ON "pairing_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "message_log_wa_message_id_key" ON "message_log"("wa_message_id");

-- CreateIndex
CREATE INDEX "message_log_chat_id_created_at_idx" ON "message_log"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_usage_logs_ts_call_type_idx" ON "llm_usage_logs"("ts", "call_type");

-- CreateIndex
CREATE UNIQUE INDEX "daily_execution_logs_local_date_job_type_seq_key" ON "daily_execution_logs"("local_date", "job_type", "seq");

-- CreateIndex
CREATE INDEX "system_events_ts_level_idx" ON "system_events"("ts", "level");

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_priority_level_id_fkey" FOREIGN KEY ("priority_level_id") REFERENCES "priority_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateView
CREATE OR REPLACE VIEW v_active_todos AS
SELECT
    t.id,
    t.title,
    t.description,
    t.category,
    t.status,
    t.priority_level_id,
    p.rank AS priority_rank,
    p.label AS priority_label,
    p.color AS priority_color,
    t.due_at,
    t.has_specific_time,
    t.planned_date,
    t.order_id,
    t.rollover_count,
    t.created_via,
    t.google_sync_status,
    t.created_at,
    t.updated_at
FROM todos t
LEFT JOIN priority_levels p ON t.priority_level_id = p.id
WHERE t.status IN ('PENDING', 'IN_PROGRESS')
ORDER BY
    p.rank ASC,
    t.due_at ASC NULLS LAST,
    t.created_at ASC;

