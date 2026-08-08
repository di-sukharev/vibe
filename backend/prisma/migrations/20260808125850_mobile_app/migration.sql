-- CreateEnum
CREATE TYPE "push_token_platform" AS ENUM ('android', 'ios');

-- CreateEnum
CREATE TYPE "push_notification_outbox_status" AS ENUM ('pending', 'processing', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "push_delivery_status" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "apple_subject" TEXT,
ADD COLUMN     "google_subject" TEXT;

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "installation_id" UUID,
    "registration_session_id" UUID,
    "expo_push_token" TEXT NOT NULL,
    "platform" "push_token_platform",
    "device_id" TEXT,
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_installations" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "authority_secret_hash" TEXT,
    "generation" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_notification_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" "push_notification_outbox_status" NOT NULL DEFAULT 'pending',
    "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processing_token" UUID,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "outbox_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "push_token_id" UUID,
    "expo_push_token" TEXT,
    "registration_installation_id" UUID,
    "registration_generation" INTEGER,
    "registration_session_id" UUID,
    "status" "push_delivery_status" NOT NULL DEFAULT 'pending',
    "ticket_id" TEXT,
    "provider_status" TEXT,
    "provider_error_code" TEXT,
    "error_message" TEXT,
    "receipt_check_attempts" INTEGER NOT NULL DEFAULT 0,
    "receipt_next_check_at" TIMESTAMP(3),
    "receipt_claim_token" UUID,
    "receipt_claimed_at" TIMESTAMP(3),
    "receipt_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_installation_id_key" ON "push_tokens"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_expo_push_token_key" ON "push_tokens"("expo_push_token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_disabled_at_idx" ON "push_tokens"("user_id", "disabled_at");

-- CreateIndex
CREATE INDEX "push_tokens_registration_session_id_idx" ON "push_tokens"("registration_session_id");

-- CreateIndex
CREATE INDEX "push_installations_owner_user_id_idx" ON "push_installations"("owner_user_id");

-- CreateIndex
CREATE INDEX "push_notification_outbox_status_scheduled_for_idx" ON "push_notification_outbox"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "push_notification_outbox_user_id_idx" ON "push_notification_outbox"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_notification_outbox_user_id_dedupe_key_key" ON "push_notification_outbox"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "push_deliveries_ticket_id_status_idx" ON "push_deliveries"("ticket_id", "status");

-- CreateIndex
CREATE INDEX "push_deliveries_status_receipt_next_check_at_idx" ON "push_deliveries"("status", "receipt_next_check_at");

-- CreateIndex
CREATE INDEX "push_deliveries_user_id_created_at_idx" ON "push_deliveries"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_deliveries_outbox_id_push_token_id_key" ON "push_deliveries"("outbox_id", "push_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_apple_subject_key" ON "users"("apple_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "push_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_installations" ADD CONSTRAINT "push_installations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notification_outbox" ADD CONSTRAINT "push_notification_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "push_notification_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

