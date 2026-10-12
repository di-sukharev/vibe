-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "subscription_platform" AS ENUM ('android', 'ios');

-- CreateEnum
CREATE TYPE "subscription_state" AS ENUM ('inactive', 'pending', 'active', 'billing_grace_period', 'billing_retry', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "push_token_platform" AS ENUM ('android', 'ios');

-- CreateEnum
CREATE TYPE "push_notification_outbox_status" AS ENUM ('pending', 'processing', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "push_delivery_status" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "task_outbox_status" AS ENUM ('pending', 'processing', 'done', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "user_avatar_state" AS ENUM ('pending', 'ready');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "apple_subject" TEXT,
    "google_subject" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "refresh_token_family_hash" TEXT,
    "previous_refresh_token_hash" TEXT,
    "refresh_rotated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "policy" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("policy","key","window_start")
);

-- CreateTable
CREATE TABLE "subscription_entitlements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "user_id" UUID NOT NULL,
    "entitlement_key" TEXT NOT NULL DEFAULT 'premium',
    "platform" "subscription_platform",
    "state" "subscription_state" NOT NULL DEFAULT 'inactive',
    "product_id" TEXT,
    "original_transaction_id" TEXT,
    "transaction_id" TEXT,
    "web_order_line_item_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "will_auto_renew" BOOLEAN,
    "google_play_purchase_id" UUID,
    "app_store_signed_at" TIMESTAMP(3),
    "environment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_store_transactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "original_transaction_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "web_order_line_item_id" TEXT,
    "product_id" TEXT NOT NULL,
    "state" "subscription_state" NOT NULL,
    "environment" TEXT,
    "app_account_token" TEXT,
    "purchase_date" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "will_auto_renew" BOOLEAN,
    "signed_transaction_hash" TEXT NOT NULL,
    "signed_renewal_hash" TEXT,
    "state_signed_at" TIMESTAMP(3),
    "transaction_signed_at" TIMESTAMP(3),
    "transaction_expires_at" TIMESTAMP(3),
    "is_upgraded" BOOLEAN NOT NULL DEFAULT false,
    "renewal_signed_at" TIMESTAMP(3),
    "grace_period_expires_at" TIMESTAMP(3),
    "is_in_billing_retry_period" BOOLEAN,
    "status_signed_at" TIMESTAMP(3),
    "provider_status" "subscription_state",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_store_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_store_webhooks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "notification_uuid" TEXT,
    "signed_payload_hash" TEXT NOT NULL,
    "notification_type" TEXT,
    "subtype" TEXT,
    "environment" TEXT,
    "original_transaction_id" TEXT,
    "transaction_id" TEXT,
    "claim_token" UUID,
    "claimed_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_store_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_play_subscription_purchases" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "replaces_linked_purchase" BOOLEAN NOT NULL DEFAULT false,
    "superseded_by_id" UUID,
    "user_id" UUID NOT NULL,
    "purchase_token" TEXT NOT NULL,
    "purchase_token_hash" TEXT NOT NULL,
    "linked_purchase_token" TEXT,
    "linked_purchase_token_hash" TEXT,
    "product_id" TEXT NOT NULL,
    "base_plan_id" TEXT,
    "latest_order_id" TEXT,
    "state" "subscription_state" NOT NULL,
    "environment" TEXT,
    "acknowledgement_state" TEXT,
    "external_account_id" TEXT,
    "external_profile_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "will_auto_renew" BOOLEAN,
    "acknowledged_at" TIMESTAMP(3),
    "reconcile_attempted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_play_subscription_purchases_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "user_avatars" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "state" "user_avatar_state" NOT NULL DEFAULT 'pending',
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_apple_subject_key" ON "users"("apple_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_created_at_idx" ON "password_reset_tokens"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_family_hash_key" ON "auth_sessions"("refresh_token_family_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_previous_refresh_token_hash_key" ON "auth_sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_entitlements_user_id_key" ON "subscription_entitlements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_entitlements_original_transaction_id_key" ON "subscription_entitlements"("original_transaction_id");

-- CreateIndex
CREATE INDEX "subscription_entitlements_google_purchase_idx" ON "subscription_entitlements"("google_play_purchase_id");

-- CreateIndex
CREATE INDEX "subscription_entitlements_state_idx" ON "subscription_entitlements"("state");

-- CreateIndex
CREATE INDEX "subscription_entitlements_expires_at_idx" ON "subscription_entitlements"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_transactions_transaction_id_key" ON "app_store_transactions"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_transactions_signed_transaction_hash_key" ON "app_store_transactions"("signed_transaction_hash");

-- CreateIndex
CREATE INDEX "app_store_transactions_user_id_idx" ON "app_store_transactions"("user_id");

-- CreateIndex
CREATE INDEX "app_store_transactions_original_transaction_id_idx" ON "app_store_transactions"("original_transaction_id");

-- CreateIndex
CREATE INDEX "app_store_transactions_state_idx" ON "app_store_transactions"("state");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_webhooks_notification_uuid_key" ON "app_store_webhooks"("notification_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_webhooks_signed_payload_hash_key" ON "app_store_webhooks"("signed_payload_hash");

-- CreateIndex
CREATE INDEX "app_store_webhooks_original_transaction_id_idx" ON "app_store_webhooks"("original_transaction_id");

-- CreateIndex
CREATE INDEX "app_store_webhooks_processed_at_idx" ON "app_store_webhooks"("processed_at");

-- CreateIndex
CREATE INDEX "app_store_webhooks_claim_lease_idx" ON "app_store_webhooks"("processed_at", "claimed_at");

-- CreateIndex
CREATE UNIQUE INDEX "google_play_subscription_purchases_purchase_token_hash_key" ON "google_play_subscription_purchases"("purchase_token_hash");

-- CreateIndex
CREATE INDEX "google_play_subs_superseded_by_idx" ON "google_play_subscription_purchases"("superseded_by_id");

-- CreateIndex
CREATE INDEX "google_play_subs_user_id_idx" ON "google_play_subscription_purchases"("user_id");

-- CreateIndex
CREATE INDEX "google_play_subs_linked_token_hash_idx" ON "google_play_subscription_purchases"("linked_purchase_token_hash");

-- CreateIndex
CREATE INDEX "google_play_subs_product_id_idx" ON "google_play_subscription_purchases"("product_id");

-- CreateIndex
CREATE INDEX "google_play_subs_state_idx" ON "google_play_subscription_purchases"("state");

-- CreateIndex
CREATE INDEX "google_play_subs_state_reconcile_attempted_at_idx" ON "google_play_subscription_purchases"("state", "reconcile_attempted_at");

-- CreateIndex
CREATE INDEX "google_play_subs_expires_at_idx" ON "google_play_subscription_purchases"("expires_at");

-- CreateIndex
CREATE INDEX "google_play_subs_latest_order_id_idx" ON "google_play_subscription_purchases"("latest_order_id");

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
CREATE INDEX "task_outbox_status_scheduled_for_idx" ON "task_outbox"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "task_outbox_status_processed_at_idx" ON "task_outbox"("status", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_outbox_type_dedupe_key_key" ON "task_outbox"("type", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_avatars_object_key_key" ON "user_avatars"("object_key");

-- CreateIndex
CREATE INDEX "user_avatars_state_expires_at_idx" ON "user_avatars"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_avatars_user_id_state_key" ON "user_avatars"("user_id", "state");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_entitlements" ADD CONSTRAINT "subscription_entitlements_google_purchase_fkey" FOREIGN KEY ("google_play_purchase_id") REFERENCES "google_play_subscription_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_entitlements" ADD CONSTRAINT "subscription_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_store_transactions" ADD CONSTRAINT "app_store_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_play_subscription_purchases" ADD CONSTRAINT "google_play_subscription_purchases_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "google_play_subscription_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_play_subscription_purchases" ADD CONSTRAINT "google_play_subscription_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
