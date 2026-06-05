-- AlterEnum
ALTER TYPE "subscription_platform" ADD VALUE 'android';

-- CreateTable
CREATE TABLE "google_play_subscription_purchases" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_play_subscription_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_play_subscription_purchases_purchase_token_hash_key" ON "google_play_subscription_purchases"("purchase_token_hash");

-- CreateIndex
CREATE INDEX "google_play_subs_user_id_idx" ON "google_play_subscription_purchases"("user_id");

-- CreateIndex
CREATE INDEX "google_play_subs_linked_token_hash_idx" ON "google_play_subscription_purchases"("linked_purchase_token_hash");

-- CreateIndex
CREATE INDEX "google_play_subs_product_id_idx" ON "google_play_subscription_purchases"("product_id");

-- CreateIndex
CREATE INDEX "google_play_subs_state_idx" ON "google_play_subscription_purchases"("state");

-- CreateIndex
CREATE INDEX "google_play_subs_expires_at_idx" ON "google_play_subscription_purchases"("expires_at");

-- CreateIndex
CREATE INDEX "google_play_subs_latest_order_id_idx" ON "google_play_subscription_purchases"("latest_order_id");

-- AddForeignKey
ALTER TABLE "google_play_subscription_purchases" ADD CONSTRAINT "google_play_subscription_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
