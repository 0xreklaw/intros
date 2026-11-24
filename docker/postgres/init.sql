-- Runs once, when the local Postgres volume is first created.
--
-- `intros` (the container's superuser) owns the schema and runs migrations. It is never used by
-- the app: superusers bypass row-level security. The app connects as `intros_app`, which cannot.
-- In production, create the same two roles by hand and point DATABASE_URL at the restricted one.

CREATE ROLE intros_app LOGIN PASSWORD 'intros_app'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE intros TO intros_app;
GRANT USAGE ON SCHEMA public TO intros_app;

-- Tables created later by the owner are usable by the app.
ALTER DEFAULT PRIVILEGES FOR ROLE intros IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO intros_app;
ALTER DEFAULT PRIVILEGES FOR ROLE intros IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO intros_app;
