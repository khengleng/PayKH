-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('SLACK', 'ZAPIER', 'WEBHOOK');

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "enabledEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Connector_storeId_idx" ON "Connector"("storeId");

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

