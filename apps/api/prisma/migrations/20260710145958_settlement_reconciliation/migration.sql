-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'SETTLED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "settlementId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "feeBps" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "payoutDate" TIMESTAMP(3) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'SETTLED',
    "grossAmount" DECIMAL(20,4) NOT NULL,
    "refundAmount" DECIMAL(20,4) NOT NULL,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(20,4) NOT NULL,
    "netAmount" DECIMAL(20,4) NOT NULL,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationReport" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "provider" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "mismatched" INTEGER NOT NULL DEFAULT 0,
    "discrepancies" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Settlement_storeId_payoutDate_idx" ON "Settlement"("storeId", "payoutDate");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_storeId_currency_payoutDate_key" ON "Settlement"("storeId", "currency", "payoutDate");

-- CreateIndex
CREATE INDEX "ReconciliationReport_storeId_createdAt_idx" ON "ReconciliationReport"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
