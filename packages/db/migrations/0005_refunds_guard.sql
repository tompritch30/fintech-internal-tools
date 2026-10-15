-- Refunds app invariants at the database level. The app code in
-- apps/web/app/(platform)/refunds enforces the rules; these back it up for raw
-- SQL and future code paths. Removing any of them needs a new, reviewed migration.
-- 1. refunds: content is immutable and status only moves pending -> succeeded,
--    so a succeeded refund can never be processed (or paid out) again.
-- 2. payments.refunded_pence <= amount_pence is a CHECK (0004), so concurrent
--    writers can never over-refund a payment.
-- 3. Least privilege for app_runtime: payments are read-only except
--    refunded_pence; refunds have no DELETE; the mock provider ledger is
--    insert-only. Payments are created by the seed (app_owner) only.

CREATE FUNCTION refunds_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.status = 'pending' AND NEW.provider_refund_id IS NULL AND NEW.processed_at IS NULL) THEN
      RAISE EXCEPTION 'new refunds must start pending';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'refund is already %', OLD.status;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.amount_pence IS DISTINCT FROM OLD.amount_pence
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requires_approval IS DISTINCT FROM OLD.requires_approval
     OR NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'refund content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_guard
  BEFORE INSERT OR UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_guard();
--> statement-breakpoint
REVOKE ALL ON payments, refunds, mock_provider_refunds FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON payments TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (refunded_pence) ON payments TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON refunds TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON mock_provider_refunds TO app_runtime;
