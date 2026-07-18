-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "paychainWalletId" TEXT;

-- AlterTable
ALTER TABLE "GiftCardTransaction" ADD COLUMN     "providerTxnId" TEXT;
