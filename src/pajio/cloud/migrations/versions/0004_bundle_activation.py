"""Immutable capacity bindings and authenticated, fenced activation outbox."""
from alembic import op
from sqlalchemy import text
from pajio.cloud.migrations.bundle_0004 import (ACTIVATION_FUNCTIONS, DEFINER_TABLES, FUNCTION_ARGUMENTS,
    FUNCTION_BODIES, FUNCTION_SIGNATURES, REGISTRATION_FUNCTIONS, TABLES, TRIGGER_BODIES, WEB_FUNCTIONS)

revision = 'pajio_control_0004'
down_revision = 'pajio_control_0003'
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    if db.scalar(text("""SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname='pajio_activation'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls""")) != 1:
        raise RuntimeError('Provision the restricted activation NOLOGIN role before migration')
    owner = db.scalar(text('SELECT current_user'))
    quote = db.dialect.identifier_preparer.quote
    db.execute(text("""CREATE TABLE pajio_control.pajio_bundles (
      id varchar(32) PRIMARY KEY CHECK(id ~ '^[a-f0-9]{32}$'),
      tenant_id varchar(128) NOT NULL UNIQUE REFERENCES pajio_control.pajio_tenants(id),
      instance_id varchar(128) NOT NULL, host varchar(128) NOT NULL,
      reservation_sha256 varchar(64) NOT NULL CHECK(reservation_sha256 ~ '^[a-f0-9]{64}$'),
      worker_plan_sha256 varchar(64) NOT NULL CHECK(worker_plan_sha256 ~ '^[a-f0-9]{64}$'),
      members_json text NOT NULL CHECK(jsonb_typeof(members_json::jsonb)='object'),
      reservation_expires_at integer NOT NULL, created_at integer NOT NULL,
      CHECK(reservation_expires_at>created_at))"""))
    db.execute(text("""ALTER TABLE pajio_control.pajio_invitations
      ADD COLUMN bundle_id varchar(32) UNIQUE REFERENCES pajio_control.pajio_bundles(id)"""))
    db.execute(text("""CREATE TABLE pajio_control.pajio_bundle_activations (
      id varchar(32) PRIMARY KEY CHECK(id ~ '^[a-f0-9]{32}$'),
      invitation_id varchar(32) NOT NULL UNIQUE REFERENCES pajio_control.pajio_invitations(id),
      bundle_id varchar(32) NOT NULL UNIQUE REFERENCES pajio_control.pajio_bundles(id),
      user_id varchar(128) NOT NULL REFERENCES pajio_control.pajio_users(id),
      tenant_id varchar(128) NOT NULL REFERENCES pajio_control.pajio_tenants(id), instance_id varchar(128) NOT NULL,
      ownership_revision integer NOT NULL CHECK(ownership_revision>0),
      member_digest varchar(64) NOT NULL CHECK(member_digest ~ '^[a-f0-9]{64}$'),
      state varchar(32) NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','preparing','installing','pairing','ready','needs_review')),
      members_json text NOT NULL CHECK(jsonb_typeof(members_json::jsonb)='object'),
      step varchar(80) NOT NULL DEFAULT 'planned', receipt_sha256 varchar(64) CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
      reason varchar(80) CHECK(reason='provisioning_requires_review'), generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
      lease_owner varchar(32) CHECK(lease_owner ~ '^[a-f0-9]{32}$'), lease_until integer,
      created_at integer NOT NULL, updated_at integer NOT NULL,
      CHECK((lease_owner IS NULL)=(lease_until IS NULL)),
      CHECK(state<>'ready' OR (receipt_sha256 IS NOT NULL
        AND members_json::jsonb->'core'->>'state'='ready'
        AND members_json::jsonb->'linux'->>'state'='ready'
        AND members_json::jsonb->'android'->>'state'='ready')))"""))
    db.execute(text('CREATE INDEX pajio_activation_claim ON pajio_control.pajio_bundle_activations(state,lease_until,created_at,id)'))
    for table in sorted(TABLES):
        db.execute(text(f'REVOKE ALL ON pajio_control.{table} FROM PUBLIC,pajio_web,pajio_registration,pajio_activation'))
        db.execute(text(f'ALTER TABLE pajio_control.{table} ENABLE ROW LEVEL SECURITY'))
        db.execute(text(f'ALTER TABLE pajio_control.{table} FORCE ROW LEVEL SECURITY'))
        db.execute(text(f'CREATE POLICY operator_all ON pajio_control.{table} TO pajio_operator USING(true) WITH CHECK(true)'))
        db.execute(text(f'CREATE POLICY web_scope ON pajio_control.{table} FOR SELECT TO pajio_web USING(false)'))
        db.execute(text(f'CREATE POLICY invitation_definer ON pajio_control.{table} TO {quote(owner)} USING(true) WITH CHECK(true)'))
        db.execute(text(f'GRANT SELECT ON pajio_control.{table} TO pajio_web,pajio_operator'))
    db.execute(text('GRANT INSERT ON pajio_control.pajio_bundles TO pajio_operator'))
    db.execute(text('GRANT USAGE ON SCHEMA pajio_control TO pajio_activation'))
    db.execute(text('GRANT SELECT ON pajio_control.alembic_version TO pajio_activation'))
    for name, body in FUNCTION_BODIES.items():
        result = 'boolean' if name == 'invitation_check' else 'jsonb'
        db.exec_driver_sql(f'CREATE OR REPLACE FUNCTION pajio_control.{name}({FUNCTION_ARGUMENTS[name]}) RETURNS {result} '
            f'LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pajio_control AS $body${body}$body$',
            execution_options={'no_parameters': True})
        signature = f'pajio_control.{name}({FUNCTION_SIGNATURES[name]})'
        db.execute(text(f'REVOKE ALL ON FUNCTION {signature} FROM PUBLIC,pajio_web,pajio_registration,pajio_operator,pajio_activation'))
        for allowed, role in ((WEB_FUNCTIONS,'pajio_web'),(REGISTRATION_FUNCTIONS,'pajio_registration'),(ACTIVATION_FUNCTIONS,'pajio_activation')):
            if name in allowed:
                db.execute(text(f'GRANT EXECUTE ON FUNCTION {signature} TO {role}'))
    for name, body in TRIGGER_BODIES.items():
        db.exec_driver_sql(f'CREATE FUNCTION pajio_control.{name}() RETURNS trigger LANGUAGE plpgsql '
            f'SET search_path=pg_catalog,pajio_control AS $body${body}$body$', execution_options={'no_parameters': True})
        db.execute(text(f'REVOKE ALL ON FUNCTION pajio_control.{name}() FROM PUBLIC,pajio_web,pajio_registration,pajio_operator,pajio_activation'))
    for name, table, events in (
        ('bundle_immutable','pajio_bundles','UPDATE OR DELETE'),
        ('invitation_bundle_immutable','pajio_invitations','INSERT OR UPDATE'),
        ('activation_scope_immutable','pajio_bundle_activations','UPDATE'),
    ):
        db.execute(text(f'CREATE TRIGGER {name} BEFORE {events} ON pajio_control.{table} '
                        f'FOR EACH ROW EXECUTE FUNCTION pajio_control.{name}()'))


def downgrade():
    raise RuntimeError('Capacity reservations and activation receipts must not be automatically discarded')
