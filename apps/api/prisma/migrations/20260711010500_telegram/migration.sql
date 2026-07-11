-- CreateTable
CREATE TABLE "TelegramConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "chatId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramConfig_storeId_key" ON "TelegramConfig"("storeId");

-- AddForeignKey
ALTER TABLE "TelegramConfig" ADD CONSTRAINT "TelegramConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

