-- AlterTable
ALTER TABLE "app_store_webhooks" ADD COLUMN     "claim_token" UUID,
ADD COLUMN     "claimed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "app_store_webhooks_claim_lease_idx" ON "app_store_webhooks"("processed_at", "claimed_at");
