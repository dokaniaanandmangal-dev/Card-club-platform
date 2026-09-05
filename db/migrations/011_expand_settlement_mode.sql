BEGIN;

ALTER TABLE club_settings
  ADD COLUMN IF NOT EXISTS settlement_mode text;

ALTER TABLE club_settings
  DROP CONSTRAINT IF EXISTS club_settings_settlement_mode_check;

ALTER TABLE club_settings
  ADD CONSTRAINT club_settings_settlement_mode_check
  CHECK (settlement_mode IS NULL OR settlement_mode IN ('manual', 'auto'))
  NOT VALID;

COMMIT;
