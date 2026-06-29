-- AlterTable: track when broker commission is remitted
ALTER TABLE "sales" ADD COLUMN "brokerCommissionPaidAt" TIMESTAMP(3);
