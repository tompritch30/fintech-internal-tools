-- audit_log is append-only. Two independent controls:
-- 1. Triggers reject UPDATE, DELETE and TRUNCATE for every role (including the owner).
-- 2. app_runtime (the role the app uses) is only granted SELECT and INSERT.
-- Removing either control needs a new, reviewed migration.

CREATE FUNCTION audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();
--> statement-breakpoint
REVOKE ALL ON audit_log, users, roles, user_roles, sessions FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users, user_roles, sessions TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON roles TO app_runtime;
