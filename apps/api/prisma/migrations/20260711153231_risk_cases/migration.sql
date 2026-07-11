-- CreateEnum
CREATE TYPE "RiskCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'ESCALATED');

-- CreateTable
CREATE TABLE "RiskCase" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "paymentId" TEXT,
    "customerId" TEXT,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RiskCaseStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskCase_storeId_status_idx" ON "RiskCase"("storeId", "status");

-- CreateIndex
CREATE INDEX "RiskCase_paymentId_idx" ON "RiskCase"("paymentId");

-- AddForeignKey
ALTER TABLE "RiskCase" ADD CONSTRAINT "RiskCase_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

