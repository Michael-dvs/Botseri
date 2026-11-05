-- AlterTable
ALTER TABLE "bot_settings" ADD COLUMN "customer_data_retention_days" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "bot_settings" ADD COLUMN "ai_form_fallback_requires_paid_model" BOOLEAN NOT NULL DEFAULT false;
