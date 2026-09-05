BEGIN;

ALTER TABLE club_settings
  ALTER COLUMN settlement_mode DROP NOT NULL;

ALTER TABLE club_settings
  ALTER COLUMN settlement_mode DROP DEFAULT;

ALTER TABLE club_settings
  DROP CONSTRAINT IF EXISTS club_settings_settlement_mode_check;

ALTER TABLE club_settings
  DROP COLUMN IF EXISTS settlement_mode;

COMMIT;
