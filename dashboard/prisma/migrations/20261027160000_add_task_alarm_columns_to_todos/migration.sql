-- AlterTable
ALTER TABLE "todos" ADD COLUMN "reminded_at" TIMESTAMPTZ(3);
ALTER TABLE "todos" ADD COLUMN "reminder_claimed_at" TIMESTAMPTZ(3);
ALTER TABLE "todos" ADD COLUMN "reminder_attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "todos_status_reminded_at_due_at_idx" ON "todos"("status", "reminded_at", "due_at");
