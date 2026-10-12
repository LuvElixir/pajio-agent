-- Execute as a database administrator on a dedicated Pajio control database.
-- No login passwords, superuser credentials or tenant content belong here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pajio_web') THEN
    CREATE ROLE pajio_web NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pajio_operator') THEN
    CREATE ROLE pajio_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pajio_registration') THEN
    CREATE ROLE pajio_registration NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pajio_cleanup') THEN
    CREATE ROLE pajio_cleanup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pajio_activation') THEN
    CREATE ROLE pajio_activation NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles
             WHERE rolname IN ('pajio_web', 'pajio_operator', 'pajio_registration', 'pajio_cleanup', 'pajio_activation')
               AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Existing Pajio privilege roles do not match the required boundary';
  END IF;
END $$;
-- Provision separate LOGIN roles through the operator's secret system, then:
-- GRANT pajio_web TO <application_login>;
-- GRANT pajio_operator TO <operator_login>;
-- GRANT pajio_registration TO <registration_broker_login>;
-- GRANT pajio_cleanup TO <expired_state_maintenance_login>;
-- The registration broker role can execute only the fixed invitation functions.
-- Never grant the operator, web or migration roles to the registration broker.
-- The migration owner must be separate from both; never grant it to the app.

-- GRANT pajio_activation TO <bundle_activation_login>;
-- The activation login executes only fenced lease/progress functions.
-- Do not grant web/operator/registration/cleanup or migration-owner membership.
