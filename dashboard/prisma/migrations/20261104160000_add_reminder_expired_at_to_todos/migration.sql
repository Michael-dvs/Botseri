-- AlterTable
ALTER TABLE "todos" ADD COLUMN "reminder_expired_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "todos_status_reminded_at_reminder_expired_at_idx" ON "todos"("status", "reminded_at", "reminder_expired_at");
