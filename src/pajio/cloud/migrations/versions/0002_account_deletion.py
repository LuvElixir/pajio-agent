"""Explicit ownership and immutable self-service deletion admission."""
from alembic import op
from sqlalchemy import text

revision = "pajio_control_0002"
down_revision = "pajio_control_0001"
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    for table in ("pajio_users", "pajio_tenants"):
        db.execute(text(f"ALTER TABLE pajio_control.{table} ADD COLUMN deletion_state varchar(16) NOT NULL DEFAULT 'active' CHECK (deletion_state IN ('active','frozen'))"))
    db.execute(text("ALTER TABLE pajio_control.pajio_sessions ADD COLUMN auth_time integer"))
    db.execute(text("""CREATE TABLE pajio_control.pajio_tenant_ownership (
      tenant_id varchar(128) PRIMARY KEY REFERENCES pajio_control.pajio_tenants(id),
      classification varchar(16) NOT NULL CHECK(classification IN ('private','shared','unknown')),
      owner_user_id varchar(128) REFERENCES pajio_control.pajio_users(id),
      member_count integer NOT NULL CHECK(member_count>0), member_digest varchar(64) NOT NULL,
      instance_id varchar(128), revision integer NOT NULL CHECK(revision>0))"""))
    db.execute(text("""CREATE TABLE pajio_control.pajio_deletion_requests (
      id varchar(32) PRIMARY KEY, user_id varchar(128) NOT NULL UNIQUE REFERENCES pajio_control.pajio_users(id),
      request_key varchar(120) NOT NULL, plan_revision varchar(64) NOT NULL, plan_json text NOT NULL,
      created_at integer NOT NULL, state varchar(32) NOT NULL DEFAULT 'awaiting_operator'
        CHECK(state IN ('awaiting_operator','frozen','waiting','completed')),
      code varchar(64) NOT NULL DEFAULT 'adapter_unconfigured', updated_at integer,
      UNIQUE(user_id,request_key))"""))
    for table in ("pajio_tenant_ownership", "pajio_deletion_requests"):
        db.execute(text(f"REVOKE ALL ON pajio_control.{table} FROM PUBLIC, pajio_web"))
        db.execute(text(f"ALTER TABLE pajio_control.{table} ENABLE ROW LEVEL SECURITY"))
        db.execute(text(f"ALTER TABLE pajio_control.{table} FORCE ROW LEVEL SECURITY"))
        db.execute(text(f"CREATE POLICY operator_all ON pajio_control.{table} TO pajio_operator USING (true) WITH CHECK (true)"))
        db.execute(text(f"GRANT SELECT,INSERT,UPDATE,DELETE ON pajio_control.{table} TO pajio_operator"))
        db.execute(text(f"GRANT SELECT ON pajio_control.{table} TO pajio_web"))
    db.execute(text("""CREATE POLICY web_scope ON pajio_control.pajio_tenant_ownership FOR SELECT TO pajio_web USING
      (EXISTS (SELECT 1 FROM pajio_control.pajio_memberships m WHERE m.tenant_id=pajio_tenant_ownership.tenant_id
        AND m.user_id=current_setting('pajio.user_id',true)))"""))
    db.execute(text("""CREATE POLICY web_scope ON pajio_control.pajio_deletion_requests TO pajio_web
      USING (user_id=current_setting('pajio.user_id',true))
      WITH CHECK (user_id=current_setting('pajio.user_id',true) AND state='awaiting_operator'
        AND code='adapter_unconfigured' AND updated_at IS NULL
        AND EXISTS(SELECT 1 FROM pajio_control.pajio_users u WHERE u.id=user_id AND u.deletion_state='active'))"""))
    db.execute(text("GRANT INSERT (id,user_id,request_key,plan_revision,plan_json,created_at) ON pajio_control.pajio_deletion_requests TO pajio_web"))
    db.execute(text("DROP POLICY web_scope ON pajio_control.pajio_sessions"))
    db.execute(text("""CREATE POLICY web_scope ON pajio_control.pajio_sessions TO pajio_web
      USING (id_hash=current_setting('pajio.session_hash',true)) WITH CHECK
      (id_hash=current_setting('pajio.session_hash',true) AND user_id=current_setting('pajio.user_id',true)
       AND EXISTS(SELECT 1 FROM pajio_control.pajio_memberships m WHERE m.user_id=pajio_sessions.user_id
         AND m.tenant_id=pajio_sessions.tenant_id AND m.active)
       AND EXISTS(SELECT 1 FROM pajio_control.pajio_users u WHERE u.id=pajio_sessions.user_id AND u.deletion_state='active')
       AND NOT EXISTS(SELECT 1 FROM pajio_control.pajio_deletion_requests d WHERE d.user_id=pajio_sessions.user_id))"""))


def downgrade():
    raise RuntimeError("Deletion fences and receipts must not be automatically discarded")
