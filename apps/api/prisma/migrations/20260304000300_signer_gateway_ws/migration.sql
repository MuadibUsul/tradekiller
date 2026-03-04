DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'DeviceStatus'
      AND e.enumlabel = 'ONLINE'
  ) THEN
    ALTER TYPE "DeviceStatus" ADD VALUE 'ONLINE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditAction'
      AND e.enumlabel = 'SIGNER_ONLINE'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'SIGNER_ONLINE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditAction'
      AND e.enumlabel = 'SIGNER_OFFLINE'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'SIGNER_OFFLINE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditAction'
      AND e.enumlabel = 'SIGNER_SIGNED'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'SIGNER_SIGNED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditAction'
      AND e.enumlabel = 'SIGNER_DENIED'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'SIGNER_DENIED';
  END IF;
END $$;

ALTER TABLE "signer_requests"
ALTER COLUMN "deviceId" DROP NOT NULL;

ALTER TABLE "signer_requests"
ADD COLUMN "signed_at" TIMESTAMP(3);

ALTER TABLE "signer_requests"
DROP CONSTRAINT IF EXISTS "signer_requests_deviceId_fkey";

ALTER TABLE "signer_requests"
ADD CONSTRAINT "signer_requests_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
