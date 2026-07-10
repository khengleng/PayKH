-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "md5" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "qrString" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "graceUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "lastWarnedLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
