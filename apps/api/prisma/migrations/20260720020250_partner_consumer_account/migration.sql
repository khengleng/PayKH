-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumerAccount" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "bankUserId" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Partner_keyId_idx" ON "Partner"("keyId");

-- CreateIndex
CREATE INDEX "ConsumerAccount_phone_idx" ON "ConsumerAccount"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumerAccount_partnerId_bankUserId_key" ON "ConsumerAccount"("partnerId", "bankUserId");

-- AddForeignKey
ALTER TABLE "ConsumerAccount" ADD CONSTRAINT "ConsumerAccount_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
