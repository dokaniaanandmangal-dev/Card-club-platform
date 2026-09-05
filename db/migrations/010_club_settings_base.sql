BEGIN;

CREATE TABLE IF NOT EXISTS club_settings (
  tenant_id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
