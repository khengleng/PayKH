-- AlterTable
-- Rolling expiry window, in months. NULL = points never expire, which is every
-- existing program's behaviour — so no store's live balances change until an
-- operator explicitly sets a window.
ALTER TABLE "LoyaltyProgram" ADD COLUMN     "expiryMonths" INTEGER;
