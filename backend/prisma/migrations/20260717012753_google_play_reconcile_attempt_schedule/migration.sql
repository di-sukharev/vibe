-- AlterTable
ALTER TABLE "google_play_subscription_purchases" ADD COLUMN     "reconcile_attempted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "google_play_subs_state_reconcile_attempted_at_idx" ON "google_play_subscription_purchases"("state", "reconcile_attempted_at");
