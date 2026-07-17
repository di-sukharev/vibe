-- AlterTable
ALTER TABLE "push_tokens" ADD COLUMN     "installation_id" UUID,
ADD COLUMN     "registration_session_id" UUID;

-- CreateTable
CREATE TABLE "push_installations" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_installations_owner_user_id_idx" ON "push_installations"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_installation_id_key" ON "push_tokens"("installation_id");

-- CreateIndex
CREATE INDEX "push_tokens_registration_session_id_idx" ON "push_tokens"("registration_session_id");

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "push_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_installations" ADD CONSTRAINT "push_installations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
