-- L3 notification triggers. Own migration: ALTER TYPE ... ADD VALUE must not share a
-- transaction with statements that use the new values.
ALTER TYPE "NotificationType" ADD VALUE 'UNIT_SOLD';
ALTER TYPE "NotificationType" ADD VALUE 'LEASE_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'LEASE_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'LEASE_TERMINATED';
ALTER TYPE "NotificationType" ADD VALUE 'LEASE_RENT_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'FREE_RENT_ENDING_30';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_OUTSTANDING';
ALTER TYPE "NotificationType" ADD VALUE 'TI_DISBURSED';
ALTER TYPE "NotificationType" ADD VALUE 'RENT_OVERDUE';
