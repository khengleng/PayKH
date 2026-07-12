-- CreateEnum
CREATE TYPE "PaymentLinkType" AS ENUM ('LINK', 'INVOICE');

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "PaymentLinkType" NOT NULL DEFAULT 'LINK',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,2),
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "timesPaid" INTEGER NOT NULL DEFAULT 0,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "dueAt" TIMESTAMP(3),
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentLink_storeId_idx" ON "PaymentLink"("storeId");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

