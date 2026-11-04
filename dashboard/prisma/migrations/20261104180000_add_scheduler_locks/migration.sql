-- CreateTable
CREATE TABLE "scheduler_locks" (
    "name" VARCHAR(50) NOT NULL,
    "locked_until" TIMESTAMPTZ NOT NULL,
    "holder" VARCHAR(100) NOT NULL,

    CONSTRAINT "scheduler_locks_pkey" PRIMARY KEY ("name")
);
