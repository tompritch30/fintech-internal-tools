-- approval_requests invariants at the database level:
-- 1. A trigger rejects INSERTs that don't start pending at version 1, UPDATEs of
--    already-decided rows, and UPDATEs that change the request's content.
--    The engine in packages/core still enforces the rules; the trigger backstops
--    raw SQL and future code paths.
-- 2. app_runtime (the role the app uses) gets SELECT, INSERT, UPDATE only —
--    no DELETE. Requests are cancelled, never removed.
-- Removing either control needs a new, reviewed migration.

CREATE FUNCTION approval_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.status = 'pending' AND NEW.version = 1 AND NEW.decided_by IS NULL AND NEW.decided_at IS NULL) THEN
      RAISE EXCEPTION 'new approval requests must start pending';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'approval request is already %', OLD.status;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'approval request content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_requests_guard
  BEFORE INSERT OR UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION approval_requests_guard();
--> statement-breakpoint
REVOKE ALL ON approval_requests FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON approval_requests TO app_runtime;
