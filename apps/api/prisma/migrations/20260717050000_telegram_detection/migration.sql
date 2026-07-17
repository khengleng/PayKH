-- CreateTable
CREATE TABLE "TelegramPaymentSource" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "chatId" TEXT,
    "verifyCode" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramPaymentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDetection" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "paymentId" TEXT,
    "updateKey" TEXT NOT NULL,
    "amount" DECIMAL(20,4),
    "currency" TEXT,
    "rawText" TEXT NOT NULL,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentDetection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramPaymentSource_storeId_key" ON "TelegramPaymentSource"("storeId");
CREATE INDEX "TelegramPaymentSource_chatId_idx" ON "TelegramPaymentSource"("chatId");
CREATE UNIQUE INDEX "PaymentDetection_updateKey_key" ON "PaymentDetection"("updateKey");
CREATE INDEX "PaymentDetection_storeId_createdAt_idx" ON "PaymentDetection"("storeId", "createdAt");
CREATE INDEX "PaymentDetection_paymentId_idx" ON "PaymentDetection"("paymentId");

-- AddForeignKey
ALTER TABLE "TelegramPaymentSource" ADD CONSTRAINT "TelegramPaymentSource_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
