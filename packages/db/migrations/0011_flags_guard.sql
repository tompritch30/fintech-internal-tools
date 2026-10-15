-- Feature flags app invariants at the database level. The app code in
-- apps/web/app/(platform)/flags enforces the rules; these back it up for raw
-- SQL and future code paths. Removing any of them needs a new, reviewed migration.
-- 1. flag_values: a row always belongs to the same flag and environment, and
--    every update bumps version by exactly one (optimistic concurrency and the
--    stale-approval check rely on it).
-- 2. flag_changes: content is immutable and status only moves
--    pending -> applied | rejected; new rows start pending.
-- 3. Least privilege for app_runtime: flags are read-only; flag_values can only
--    have their value columns updated (no INSERT/DELETE, so a flag never loses
--    an environment); flag_changes have no DELETE and only status/decided_at
--    can change. Flags and their values are created by the seed (app_owner).

CREATE FUNCTION flag_values_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.flag_id IS DISTINCT FROM OLD.flag_id OR NEW.environment IS DISTINCT FROM OLD.environment THEN
    RAISE EXCEPTION 'flag value flag and environment are immutable';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'flag value version must increase by one';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER flag_values_guard
  BEFORE UPDATE ON flag_values
  FOR EACH ROW EXECUTE FUNCTION flag_values_guard();
--> statement-breakpoint
CREATE FUNCTION flag_changes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.status = 'pending' AND NEW.decided_at IS NULL) THEN
      RAISE EXCEPTION 'new flag changes must start pending';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'flag change is already %', OLD.status;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.flag_id IS DISTINCT FROM OLD.flag_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.before_enabled IS DISTINCT FROM OLD.before_enabled
     OR NEW.before_rollout_percentage IS DISTINCT FROM OLD.before_rollout_percentage
     OR NEW.after_enabled IS DISTINCT FROM OLD.after_enabled
     OR NEW.after_rollout_percentage IS DISTINCT FROM OLD.after_rollout_percentage
     OR NEW.base_version IS DISTINCT FROM OLD.base_version
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'flag change content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER flag_changes_guard
  BEFORE INSERT OR UPDATE ON flag_changes
  FOR EACH ROW EXECUTE FUNCTION flag_changes_guard();
--> statement-breakpoint
REVOKE ALL ON flags, flag_values, flag_changes FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON flags TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON flag_values TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (enabled, rollout_percentage, version, updated_at, updated_by) ON flag_values TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON flag_changes TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, decided_at) ON flag_changes TO app_runtime;
