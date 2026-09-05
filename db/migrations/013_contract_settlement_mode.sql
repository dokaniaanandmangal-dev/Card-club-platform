BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM club_settings WHERE settlement_mode IS NULL) THEN
    RAISE EXCEPTION 'settlement_mode_backfill_incomplete';
  END IF;
END;
$$;

ALTER TABLE club_settings
  ALTER COLUMN settlement_mode SET NOT NULL;

COMMIT;
