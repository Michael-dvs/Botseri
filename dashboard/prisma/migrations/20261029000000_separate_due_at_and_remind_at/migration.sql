-- AlterTable
ALTER TABLE "todos" ADD COLUMN "remind_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "todos_status_reminded_at_remind_at_idx" ON "todos"("status", "reminded_at", "remind_at");
