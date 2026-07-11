-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('SCRATCH_CARD', 'SPIN_WHEEL', 'LUCKY_DRAW');

-- CreateEnum
CREATE TYPE "PrizeType" AS ENUM ('NONE', 'POINTS', 'REWARD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GamePlayStatus" AS ENUM ('ISSUED', 'REVEALED');

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GameType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "autoIssue" BOOLEAN NOT NULL DEFAULT false,
    "minPaymentAmount" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prize" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "PrizeType" NOT NULL DEFAULT 'NONE',
    "pointsValue" INTEGER NOT NULL DEFAULT 0,
    "rewardId" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "stock" INTEGER NOT NULL DEFAULT -1,
    "awarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePlay" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "prizeId" TEXT,
    "status" "GamePlayStatus" NOT NULL DEFAULT 'REVEALED',
    "won" BOOLEAN NOT NULL DEFAULT false,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMP(3),

    CONSTRAINT "GamePlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_storeId_idx" ON "Game"("storeId");

-- CreateIndex
CREATE INDEX "Prize_gameId_idx" ON "Prize"("gameId");

-- CreateIndex
CREATE INDEX "GamePlay_gameId_idx" ON "GamePlay"("gameId");

-- CreateIndex
CREATE INDEX "GamePlay_customerId_idx" ON "GamePlay"("customerId");

-- CreateIndex
CREATE INDEX "GamePlay_storeId_status_idx" ON "GamePlay"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GamePlay_gameId_paymentId_key" ON "GamePlay"("gameId", "paymentId");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlay" ADD CONSTRAINT "GamePlay_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlay" ADD CONSTRAINT "GamePlay_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "Prize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

