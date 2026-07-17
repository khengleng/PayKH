-- AlterTable
ALTER TABLE "LoyaltyProgram" ADD COLUMN     "expiryWarnDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
-- One "your points expire soon" warning per customer per expiry date. The job
-- runs daily and recomputes the same at-risk batch each time, so without this
-- unique index a customer would be emailed every morning until their points
-- died. `expiresOn` is derived deterministically from the points themselves, so
-- a re-run produces the same key and the index absorbs it.
CREATE TABLE "PointsExpiryNotice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "expiresOn" DATE NOT NULL,
    "points" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsExpiryNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointsExpiryNotice_customerId_expiresOn_key" ON "PointsExpiryNotice"("customerId", "expiresOn");
CREATE INDEX "PointsExpiryNotice_storeId_sentAt_idx" ON "PointsExpiryNotice"("storeId", "sentAt");

-- AddForeignKey
ALTER TABLE "PointsExpiryNotice" ADD CONSTRAINT "PointsExpiryNotice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
