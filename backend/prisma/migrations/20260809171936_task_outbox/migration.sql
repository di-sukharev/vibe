-- CreateEnum
CREATE TYPE "task_outbox_status" AS ENUM ('pending', 'processing', 'done', 'skipped', 'failed');

-- CreateTable
CREATE TABLE "task_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "task_outbox_status" NOT NULL DEFAULT 'pending',
    "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processing_token" UUID,
    "processed_at" TIMESTAMP(3),
    "redacted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_outbox_status_scheduled_for_idx" ON "task_outbox"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "task_outbox_status_processed_at_idx" ON "task_outbox"("status", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_outbox_type_dedupe_key_key" ON "task_outbox"("type", "dedupe_key");
