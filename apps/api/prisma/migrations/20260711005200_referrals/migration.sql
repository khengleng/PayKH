-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredByCustomerId" TEXT;

-- CreateTable
CREATE TABLE "ReferralProgram" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "referrerPoints" INTEGER NOT NULL DEFAULT 0,
    "refereePoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "refereeCustomerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardPointsReferrer" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsReferee" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralProgram_storeId_key" ON "ReferralProgram"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_refereeCustomerId_key" ON "Referral"("refereeCustomerId");

-- CreateIndex
CREATE INDEX "Referral_storeId_idx" ON "Referral"("storeId");

-- CreateIndex
CREATE INDEX "Referral_referrerCustomerId_idx" ON "Referral"("referrerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_referralCode_key" ON "Customer"("storeId", "referralCode");

-- AddForeignKey
ALTER TABLE "ReferralProgram" ADD CONSTRAINT "ReferralProgram_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

