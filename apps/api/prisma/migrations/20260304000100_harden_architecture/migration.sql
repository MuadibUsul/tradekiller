-- AlterTable
ALTER TABLE "signer_requests"
ADD COLUMN "request_id" TEXT NOT NULL DEFAULT '';

ALTER TABLE "signer_requests"
ADD COLUMN "execution_lock_at" TIMESTAMP(3),
ADD COLUMN "executed_at" TIMESTAMP(3);

-- Backfill request_id for existing rows.
UPDATE "signer_requests"
SET "request_id" = "id"
WHERE "request_id" = '';

ALTER TABLE "signer_requests"
ALTER COLUMN "request_id" DROP DEFAULT;

-- DropIndex
DROP INDEX IF EXISTS "positions_userId_marketId_outcomeId_key";

-- CreateIndex
CREATE UNIQUE INDEX "positions_userId_marketId_key" ON "positions"("userId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "signer_requests_request_id_key" ON "signer_requests"("request_id");

-- CreateIndex
CREATE INDEX "signer_requests_status_expiresAt_idx" ON "signer_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "signer_requests_status_executed_at_idx" ON "signer_requests"("status", "executed_at");
