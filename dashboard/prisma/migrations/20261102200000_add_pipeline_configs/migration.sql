-- CreateTable
CREATE TABLE "pipeline_configs" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(150) NOT NULL DEFAULT 'Pipeline Operasional Berseri',
    "preset_key" VARCHAR(50) NOT NULL DEFAULT 'FLORIST_DECOR',
    "config_json" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_configs_pkey" PRIMARY KEY ("id")
);
