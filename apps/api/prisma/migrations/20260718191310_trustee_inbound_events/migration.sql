-- CreateTable
CREATE TABLE "TrusteeInboundEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrusteeInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrusteeInboundEvent_type_receivedAt_idx" ON "TrusteeInboundEvent"("type", "receivedAt");

-- CreateIndex
CREATE INDEX "TrusteeInboundEvent_receivedAt_idx" ON "TrusteeInboundEvent"("receivedAt");
