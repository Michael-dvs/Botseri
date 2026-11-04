-- AlterTable
ALTER TABLE "llm_configs" ADD COLUMN "is_fallback" BOOLEAN NOT NULL DEFAULT false;

-- Create partial unique index for single fallback model
CREATE UNIQUE INDEX "llm_configs_one_fallback"
ON "llm_configs" ("is_fallback")
WHERE "is_fallback" = true;
