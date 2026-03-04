DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderStatus'
      AND e.enumlabel = 'ACK'
  ) THEN
    ALTER TYPE "OrderStatus" ADD VALUE 'ACK';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExecutionStatus') THEN
    CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'LOCKED', 'ACK', 'FILLED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "market_metrics" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "pMkt" DECIMAL(10,6) NOT NULL,
  "lastTickAge" DECIMAL(10,3) NOT NULL,
  "spreadPct" DECIMAL(10,6) NOT NULL,
  "topLiquidity" DECIMAL(20,8) NOT NULL,
  "jumpPct1m" DECIMAL(10,6) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_metrics_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "market_metrics"
ADD CONSTRAINT IF NOT EXISTS "market_metrics_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "market_metrics_userId_marketId_key"
ON "market_metrics"("userId", "marketId");

CREATE INDEX IF NOT EXISTS "market_metrics_marketId_updatedAt_idx"
ON "market_metrics"("marketId", "updatedAt");

ALTER TABLE "signer_requests"
ADD COLUMN IF NOT EXISTS "execution_status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "execution_error" TEXT;

CREATE INDEX IF NOT EXISTS "signer_requests_status_execution_status_idx"
ON "signer_requests"("status", "execution_status");
