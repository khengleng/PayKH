CREATE TYPE "TrusteeArtifactType" AS ENUM ('TRUSTEE_READINESS', 'RESERVE_SNAPSHOT', 'MINT_POLICY');

CREATE TABLE "TrusteeArtifact" (
    "id" TEXT NOT NULL,
    "type" "TrusteeArtifactType" NOT NULL,
    "scope" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "TrusteeArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrusteeArtifact_type_createdAt_idx" ON "TrusteeArtifact"("type", "createdAt");
CREATE INDEX "TrusteeArtifact_scope_createdAt_idx" ON "TrusteeArtifact"("scope", "createdAt");
