-- CreateEnum
CREATE TYPE "DeviceRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- AlterTable
ALTER TABLE "devices"
ADD COLUMN "role" "DeviceRole" NOT NULL DEFAULT 'SECONDARY';
