-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "previous_refresh_token_hash" TEXT,
ADD COLUMN     "refresh_rotated_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_previous_refresh_token_hash_key" ON "auth_sessions"("previous_refresh_token_hash");
