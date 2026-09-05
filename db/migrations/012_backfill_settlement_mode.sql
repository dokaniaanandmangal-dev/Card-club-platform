BEGIN;

UPDATE club_settings
SET settlement_mode = 'manual'
WHERE settlement_mode IS NULL;

ALTER TABLE club_settings
  ALTER COLUMN settlement_mode SET DEFAULT 'manual';

ALTER TABLE club_settings
  VALIDATE CONSTRAINT club_settings_settlement_mode_check;

COMMIT;
