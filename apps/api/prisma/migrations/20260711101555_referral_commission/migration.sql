-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "ReferralProgram" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionDurationDays" INTEGER;

-- CreateTable
CREATE TABLE "ReferralCommission" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "bps" INTEGER NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "payoutRef" TEXT,

    CONSTRAINT "ReferralCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCommission_paymentId_key" ON "ReferralCommission"("paymentId");

-- CreateIndex
CREATE INDEX "ReferralCommission_storeId_status_idx" ON "ReferralCommission"("storeId", "status");

-- CreateIndex
CREATE INDEX "ReferralCommission_referrerCustomerId_idx" ON "ReferralCommission"("referrerCustomerId");

-- CreateIndex
CREATE INDEX "ReferralCommission_referralId_idx" ON "ReferralCommission"("referralId");

