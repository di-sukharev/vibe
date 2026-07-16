-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "refresh_token_family_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_family_hash_key" ON "auth_sessions"("refresh_token_family_hash");
