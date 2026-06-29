-- AlterTable: track when broker commission is remitted
ALTER TABLE "Sale" ADD COLUMN "brokerCommissionPaidAt" TIMESTAMP(3);
