-- CreateEnum
CREATE TYPE "ValueTxnStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED', 'MANUAL_REVIEW', 'REVERSED');

-- AlterTable: value lifecycle on the points sub-ledger.
-- Existing rows are internal-only points, which were final the moment they were
-- written, so CONFIRMED is the correct historical value — not a placeholder.
ALTER TABLE "PointsTransaction" ADD COLUMN     "status" "ValueTxnStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "paychainTxId" TEXT,
ADD COLUMN     "statusDetail" TEXT;

-- Backfill confirmedAt for history already final, so "time to confirmation"
-- metrics have a baseline rather than a null cliff at the migration boundary.
UPDATE "PointsTransaction" SET "confirmedAt" = "createdAt" WHERE "status" = 'CONFIRMED';

-- CreateIndex
CREATE INDEX "PointsTransaction_status_idx" ON "PointsTransaction"("status");
CREATE INDEX "PointsTransaction_paychainTxId_idx" ON "PointsTransaction"("paychainTxId");

-- AlterTable: give ledger lines a customer dimension.
ALTER TABLE "LedgerEntry" ADD COLUMN     "customerId" TEXT;

-- CreateIndex
CREATE INDEX "LedgerEntry_customerId_accountCode_idx" ON "LedgerEntry"("customerId", "accountCode");

-- Seed the loyalty accounts. LedgerService.ensureAccounts() also upserts these
-- on boot, but doing it here means the backfill below can run in this same
-- migration rather than depending on the app having started first.
INSERT INTO "LedgerAccount" ("code", "name", "type") VALUES
  ('points_liability', 'Loyalty Points Liability', 'LIABILITY'),
  ('points_expense',   'Loyalty Points Expense',   'EXPENSE'),
  ('points_settled',   'Loyalty Points Settled',   'REVENUE'),
  ('points_breakage',  'Loyalty Points Breakage',  'REVENUE')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill: replay every historical PointsTransaction into the ledger.
--
-- Without this the ledger would open at zero while customers hold balances, and
-- the liability account would understate the real obligation by exactly the
-- pre-migration outstanding points.
--
-- Journals are keyed (event, reference) = ('points.<type>', PointsTransaction.id),
-- matching LedgerService.postPointsMovement, so re-running is a no-op and any
-- entry posted by the running app is skipped rather than duplicated.
--
-- The contra account mirrors postPointsMovement: sign decides direction, and the
-- reason (redeem vs expire/adjust-down) decides which contra account is used.
-- ---------------------------------------------------------------------------
WITH new_journals AS (
  INSERT INTO "JournalEntry" ("id", "storeId", "event", "reference", "currency", "createdAt")
  SELECT
    'jrn_bf_' || pt."id",
    pt."storeId",
    'points.' || lower(pt."type"::text),
    pt."id",
    'PTS',
    pt."createdAt"
  FROM "PointsTransaction" pt
  WHERE pt."points" <> 0
    AND pt."status" = 'CONFIRMED'
    AND NOT EXISTS (
      SELECT 1 FROM "JournalEntry" j
      WHERE j."event" = 'points.' || lower(pt."type"::text) AND j."reference" = pt."id"
    )
  RETURNING "id", "reference", "storeId", "createdAt"
)
INSERT INTO "LedgerEntry" ("id", "journalId", "accountCode", "storeId", "customerId", "direction", "amount", "currency", "createdAt")
SELECT * FROM (
  -- points_liability line (carries the customer)
  SELECT
    'led_bf_l_' || pt."id",
    nj."id",
    'points_liability',
    pt."storeId",
    pt."customerId",
    CASE WHEN pt."points" > 0 THEN 'CREDIT' ELSE 'DEBIT' END::"LedgerDirection",
    abs(pt."points")::numeric(20,4),
    'PTS',
    pt."createdAt"
  FROM new_journals nj
  JOIN "PointsTransaction" pt ON pt."id" = nj."reference"

  UNION ALL

  -- contra line (store-level, no customer)
  SELECT
    'led_bf_c_' || pt."id",
    nj."id",
    CASE
      WHEN pt."points" > 0 THEN 'points_expense'
      WHEN pt."type" = 'REDEEM' THEN 'points_settled'
      ELSE 'points_breakage'
    END,
    pt."storeId",
    NULL,
    CASE WHEN pt."points" > 0 THEN 'DEBIT' ELSE 'CREDIT' END::"LedgerDirection",
    abs(pt."points")::numeric(20,4),
    'PTS',
    pt."createdAt"
  FROM new_journals nj
  JOIN "PointsTransaction" pt ON pt."id" = nj."reference"
) AS lines;
