-- CreateTable
-- A tenant's own PayChain connection, configured by the organization owner.
-- The client secret is AES-256-GCM encrypted by the application (CryptoService);
-- it is never stored or returned in plaintext.
CREATE TABLE "PayChainIntegration" (
    "organizationId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.paychain.cambobia.com',
    "clientId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "loyaltyAssetId" TEXT NOT NULL,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "PayChainIntegration_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "PayChainIntegration" ADD CONSTRAINT "PayChainIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
