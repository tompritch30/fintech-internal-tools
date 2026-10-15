-- LOCAL DEV ONLY. Passwords are fake demo values.
-- Runs once as the postgres superuser (Docker entrypoint; CI runs it with psql).
-- app_owner owns the schema and runs migrations. app_runtime is the role the app uses.
CREATE ROLE app_owner LOGIN PASSWORD 'demo-only-change-me';
CREATE ROLE app_runtime LOGIN PASSWORD 'demo-only-change-me';

CREATE DATABASE internal_tools OWNER app_owner;
CREATE DATABASE internal_tools_test OWNER app_owner;

\connect internal_tools
ALTER SCHEMA public OWNER TO app_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;

\connect internal_tools_test
ALTER SCHEMA public OWNER TO app_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;
