-- Restore bootstrap only: reviewed empty target, before restoring a schema dump.
-- Creates names, not login credentials. Do not run blindly on a provider-managed database.
DO $$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['petavu_public','petavu_member','petavu_adminpanel','petavu_adminshop'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS',r);
  END IF;
 END LOOP;
END
$$;
