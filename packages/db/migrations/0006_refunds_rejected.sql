-- Rejected refunds: core's onRejected hook (PR #15) sets refunds.status = 'rejected' in the
-- rejection's transaction. The 0005 guard already makes it final (only pending rows can change).
ALTER TYPE "public"."refund_status" ADD VALUE 'rejected';
