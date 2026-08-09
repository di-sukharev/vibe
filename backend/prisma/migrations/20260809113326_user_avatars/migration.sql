-- CreateEnum
CREATE TYPE "user_avatar_state" AS ENUM ('pending', 'ready');

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
CREATE UNIQUE INDEX "user_avatars_object_key_key" ON "user_avatars"("object_key");

-- CreateIndex
CREATE INDEX "user_avatars_state_expires_at_idx" ON "user_avatars"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_avatars_user_id_state_key" ON "user_avatars"("user_id", "state");

-- AddForeignKey
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
