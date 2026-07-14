-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaLastCounter" INTEGER,
ADD COLUMN     "tokenEpoch" INTEGER NOT NULL DEFAULT 0;
