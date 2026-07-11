-- AlterEnum
ALTER TYPE "CommissionStatus" ADD VALUE 'HELD';

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "riskFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Referral_storeId_flagged_idx" ON "Referral"("storeId", "flagged");

