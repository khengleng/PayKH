-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('WHATSAPP', 'SMS', 'SIGNAL');

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channel" "NotificationChannelType" NOT NULL,
    "destination" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationChannel_storeId_idx" ON "NotificationChannel"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_storeId_channel_key" ON "NotificationChannel"("storeId", "channel");

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

