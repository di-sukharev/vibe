-- AlterTable
ALTER TABLE "push_deliveries" ADD COLUMN     "registration_generation" INTEGER,
ADD COLUMN     "registration_installation_id" UUID,
ADD COLUMN     "registration_session_id" UUID;
