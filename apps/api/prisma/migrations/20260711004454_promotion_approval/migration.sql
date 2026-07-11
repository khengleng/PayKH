-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "submittedForApproval" BOOLEAN NOT NULL DEFAULT false;
