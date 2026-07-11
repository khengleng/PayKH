-- CreateTable
CREATE TABLE "RevenueShareAgreement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueShareAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevenueShareAgreement_storeId_idx" ON "RevenueShareAgreement"("storeId");

-- AddForeignKey
ALTER TABLE "RevenueShareAgreement" ADD CONSTRAINT "RevenueShareAgreement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

