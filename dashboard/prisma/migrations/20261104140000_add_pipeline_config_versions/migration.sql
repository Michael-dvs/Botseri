-- CreateTable
CREATE TABLE "pipeline_config_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "config_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" VARCHAR(100),

    CONSTRAINT "pipeline_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_config_versions_version_idx" ON "pipeline_config_versions"("version");
