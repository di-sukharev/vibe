-- AlterTable
ALTER TABLE "push_deliveries" ADD COLUMN     "receipt_claim_token" UUID,
ADD COLUMN     "receipt_claimed_at" TIMESTAMP(3);
