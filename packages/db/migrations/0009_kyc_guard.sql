-- KYC app invariants at the database level. apps/web/app/(platform)/kyc enforces the rules;
-- these back it up for raw SQL and future code paths. Removing any of them needs a new,
-- reviewed migration.
-- 1. Retention: a closed case (approved/rejected) can't be deleted or truncated, by any role,
--    and nor can its documents. Its retention date is set once, at closing (CHECKs in 0007
--    require it and keep it at least five years after closing).
-- 2. Closed cases are final; case content (applicant details, risk flags) is immutable.
-- 3. Four-eyes: a high-risk case (risk 'high', sanctions hit or PEP) can only become
--    'approved' if an approval request of kind 'kyc.high_risk_approval' for it is approved.
-- 4. Least privilege for app_runtime: SELECT and UPDATE of the workflow columns only on
--    kyc_cases; SELECT only on kyc_documents. No INSERT, no DELETE. Cases come from the seed.

CREATE FUNCTION kyc_cases_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'closed KYC case % is retained until %', OLD.reference, OLD.retention_until;
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.status = 'open' AND NEW.owner_id IS NULL AND NEW.closed_at IS NULL AND NEW.retention_until IS NULL) THEN
      RAISE EXCEPTION 'new KYC cases must start open and unclaimed';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'KYC case is closed (%)', OLD.status;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.applicant_name IS DISTINCT FROM OLD.applicant_name
     OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     OR NEW.id_number IS DISTINCT FROM OLD.id_number
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.nationality IS DISTINCT FROM OLD.nationality
     OR NEW.risk_rating IS DISTINCT FROM OLD.risk_rating
     OR NEW.sanctions_hit IS DISTINCT FROM OLD.sanctions_hit
     OR NEW.pep IS DISTINCT FROM OLD.pep
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'KYC case content is immutable';
  END IF;
  IF NEW.status = 'approved'
     AND (OLD.risk_rating = 'high' OR OLD.sanctions_hit OR OLD.pep)
     AND NOT EXISTS (
       SELECT 1 FROM approval_requests a
       WHERE a.kind = 'kyc.high_risk_approval'
         AND a.subject_type = 'kyc_case'
         AND a.subject_id = NEW.id::text
         AND a.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'high-risk KYC case needs an approved four-eyes sign-off';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kyc_cases_guard
  BEFORE INSERT OR UPDATE OR DELETE ON kyc_cases
  FOR EACH ROW EXECUTE FUNCTION kyc_cases_guard();
--> statement-breakpoint
CREATE FUNCTION kyc_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'KYC documents are immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM kyc_cases c WHERE c.id = OLD.case_id AND c.closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'documents of a closed KYC case are retained';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kyc_documents_guard
  BEFORE UPDATE OR DELETE ON kyc_documents
  FOR EACH ROW EXECUTE FUNCTION kyc_documents_guard();
--> statement-breakpoint
CREATE FUNCTION kyc_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KYC tables are retained; TRUNCATE is not allowed';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kyc_cases_no_truncate BEFORE TRUNCATE ON kyc_cases FOR EACH STATEMENT EXECUTE FUNCTION kyc_no_truncate();
--> statement-breakpoint
CREATE TRIGGER kyc_documents_no_truncate BEFORE TRUNCATE ON kyc_documents FOR EACH STATEMENT EXECUTE FUNCTION kyc_no_truncate();
--> statement-breakpoint
REVOKE ALL ON kyc_cases, kyc_documents FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON kyc_cases TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, owner_id, claimed_at, decision_note, closed_at, retention_until) ON kyc_cases TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON kyc_documents TO app_runtime;
