"""Initial private control metadata, privileges and row scope."""

from alembic import op
from sqlalchemy import Boolean, Column, ForeignKey, ForeignKeyConstraint, Integer, MetaData, String, Table, Text, UniqueConstraint, text

from pajio.cloud.postgres import OPERATOR_ROLE, SCHEMA, WEB_ROLE

# Frozen initial schema: importing current application metadata here would make
# fresh installs accidentally create future revisions before their migrations.
TABLES = ("pajio_users", "pajio_tenants", "pajio_memberships", "pajio_routes", "pajio_sessions", "pajio_oidc_states")
metadata = MetaData()
Table("pajio_users", metadata, Column("id", String(128), primary_key=True),
      Column("issuer", Text, nullable=False), Column("subject", String(512), nullable=False), UniqueConstraint("issuer", "subject"))
Table("pajio_tenants", metadata, Column("id", String(128), primary_key=True))
Table("pajio_memberships", metadata, Column("user_id", ForeignKey("pajio_users.id"), primary_key=True),
      Column("tenant_id", ForeignKey("pajio_tenants.id"), primary_key=True), Column("active", Boolean, nullable=False))
Table("pajio_routes", metadata, Column("tenant_id", ForeignKey("pajio_tenants.id"), primary_key=True),
      Column("instance_id", String(128), nullable=False, unique=True), Column("upstream", Text, nullable=False), Column("credential_ref", String(128), nullable=False))
Table("pajio_sessions", metadata, Column("id_hash", String(64), primary_key=True), Column("user_id", String(128), nullable=False),
      Column("tenant_id", String(128), nullable=False), Column("csrf", String(64), nullable=False), Column("expires", Integer, nullable=False),
      ForeignKeyConstraint(["user_id", "tenant_id"], ["pajio_memberships.user_id", "pajio_memberships.tenant_id"]))
Table("pajio_oidc_states", metadata, Column("id_hash", String(64), primary_key=True), Column("value", Text, nullable=False), Column("expires", Integer, nullable=False))

revision = "pajio_control_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    roles = db.execute(text("SELECT rolname FROM pg_catalog.pg_roles WHERE rolname IN ('pajio_web', 'pajio_operator')")).scalars().all()
    if set(roles) != {WEB_ROLE, OPERATOR_ROLE}:
        raise RuntimeError("Provision the two NOLOGIN privilege roles before migration")
    if db.scalar(text("""
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
          WHERE rolname IN ('pajio_web', 'pajio_operator')
            AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls))
    """)):
        raise RuntimeError("Pajio privilege groups must be non-login, non-administrative roles")
    if db.scalar(text("""
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'pajio_control' AND c.relname LIKE 'pajio_%')
    """)):
        raise RuntimeError("Initial migration refuses to adopt unversioned Pajio tables")
    metadata.create_all(db.execution_options(schema_translate_map={None: SCHEMA}))
    db.execute(text("REVOKE ALL ON SCHEMA pajio_control FROM PUBLIC"))
    db.execute(text("GRANT USAGE ON SCHEMA pajio_control TO pajio_web, pajio_operator"))
    for table in TABLES:
        db.execute(text(f"REVOKE ALL ON pajio_control.{table} FROM PUBLIC, pajio_web"))
        db.execute(text(f"ALTER TABLE pajio_control.{table} ENABLE ROW LEVEL SECURITY"))
        db.execute(text(f"ALTER TABLE pajio_control.{table} FORCE ROW LEVEL SECURITY"))
        db.execute(text(f"CREATE POLICY operator_all ON pajio_control.{table} TO pajio_operator USING (true) WITH CHECK (true)"))
        db.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON pajio_control.{table} TO pajio_operator"))
        db.execute(text(f"GRANT SELECT ON pajio_control.{table} TO pajio_web"))
    scopes = {
        "pajio_users": "(id = current_setting('pajio.user_id', true) OR (issuer = current_setting('pajio.issuer', true) AND subject = current_setting('pajio.subject', true)))",
        "pajio_memberships": "user_id = current_setting('pajio.user_id', true)",
        "pajio_tenants": "id = current_setting('pajio.tenant_id', true) AND EXISTS (SELECT 1 FROM pajio_control.pajio_memberships m WHERE m.tenant_id = id AND m.user_id = current_setting('pajio.user_id', true) AND m.active)",
        "pajio_routes": "tenant_id = current_setting('pajio.tenant_id', true) AND EXISTS (SELECT 1 FROM pajio_control.pajio_memberships m WHERE m.tenant_id = pajio_routes.tenant_id AND m.user_id = current_setting('pajio.user_id', true) AND m.active)",
        "pajio_sessions": "id_hash = current_setting('pajio.session_hash', true)",
        "pajio_oidc_states": "id_hash = current_setting('pajio.state_hash', true)",
    }
    for table, expression in scopes.items():
        if table == "pajio_sessions":
            check = expression + " AND user_id = current_setting('pajio.user_id', true) AND EXISTS (SELECT 1 FROM pajio_control.pajio_memberships m WHERE m.user_id = pajio_sessions.user_id AND m.tenant_id = pajio_sessions.tenant_id AND m.active)"
            db.execute(text(f"CREATE POLICY web_scope ON pajio_control.{table} TO pajio_web USING ({expression}) WITH CHECK ({check})"))
        elif table == "pajio_oidc_states":
            db.execute(text(f"CREATE POLICY web_scope ON pajio_control.{table} TO pajio_web USING ({expression}) WITH CHECK ({expression})"))
        else:
            db.execute(text(f"CREATE POLICY web_scope ON pajio_control.{table} FOR SELECT TO pajio_web USING ({expression})"))
    db.execute(text("GRANT INSERT, DELETE ON pajio_control.pajio_sessions, pajio_control.pajio_oidc_states TO pajio_web"))
    db.execute(text("GRANT UPDATE (tenant_id) ON pajio_control.pajio_sessions TO pajio_web"))
    db.execute(text("GRANT SELECT ON pajio_control.alembic_version TO pajio_web, pajio_operator"))


def downgrade():
    raise RuntimeError("This initial control migration has no destructive automatic downgrade")
