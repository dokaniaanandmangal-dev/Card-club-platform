BEGIN;

CREATE TABLE IF NOT EXISTS settlement_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  table_id text NOT NULL CHECK (table_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  hand_id text NOT NULL CHECK (hand_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  epoch bigint NOT NULL CHECK (epoch >= 0),
  outcome_digest text NOT NULL CHECK (outcome_digest ~ '^[0-9a-f]{64}$'),
  settlement_digest text NOT NULL CHECK (settlement_digest ~ '^[0-9a-f]{64}$'),
  allocations jsonb NOT NULL CHECK (jsonb_typeof(allocations) = 'array'),
  verification_scheme text NOT NULL CHECK (verification_scheme = 'dual-v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, hand_id)
);

CREATE OR REPLACE FUNCTION deny_settlement_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_settlement_receipt';
END;
$$;

DROP TRIGGER IF EXISTS settlement_receipts_append_only ON settlement_receipts;
CREATE TRIGGER settlement_receipts_append_only
BEFORE UPDATE OR DELETE ON settlement_receipts
FOR EACH ROW EXECUTE FUNCTION deny_settlement_receipt_mutation();

CREATE OR REPLACE FUNCTION record_verified_settlement_receipt(
  p_tenant_id text,
  p_table_id text,
  p_hand_id text,
  p_epoch bigint,
  p_outcome_digest text,
  p_settlement_digest text,
  p_allocations jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing settlement_receipts%ROWTYPE;
  v_id bigint;
  v_net numeric;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
     OR p_table_id IS NULL OR p_table_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
     OR p_hand_id IS NULL OR p_hand_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid_settlement_identity';
  END IF;
  IF p_epoch IS NULL OR p_epoch < 0 THEN
    RAISE EXCEPTION 'invalid_settlement_epoch';
  END IF;
  IF p_outcome_digest IS NULL OR p_outcome_digest !~ '^[0-9a-f]{64}$'
     OR p_settlement_digest IS NULL OR p_settlement_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_settlement_digest';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) < 2 OR jsonb_array_length(p_allocations) > 64 THEN
    RAISE EXCEPTION 'invalid_settlement_allocations';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_allocations) row_value
    WHERE jsonb_typeof(row_value) <> 'object'
       OR NOT (row_value ? 'accountId')
       OR NOT (row_value ? 'deltaMinor')
       OR jsonb_typeof(row_value->'accountId') <> 'string'
       OR jsonb_typeof(row_value->'deltaMinor') <> 'string'
       OR (row_value->>'accountId') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
       OR (row_value->>'deltaMinor') !~ '^-?(0|[1-9][0-9]{0,18})$'
  ) THEN
    RAISE EXCEPTION 'invalid_settlement_allocation_row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        row_value->>'accountId' AS account_id,
        lag(row_value->>'accountId') OVER (ORDER BY ordinality) AS previous_account_id
      FROM jsonb_array_elements(p_allocations) WITH ORDINALITY AS rows(row_value, ordinality)
    ) ordered_rows
    WHERE previous_account_id IS NOT NULL AND previous_account_id >= account_id
  ) THEN
    RAISE EXCEPTION 'settlement_allocations_not_canonical';
  END IF;

  SELECT COALESCE(sum((row_value->>'deltaMinor')::numeric), 0)
    INTO v_net
    FROM jsonb_array_elements(p_allocations) row_value;
  IF v_net <> 0 THEN
    RAISE EXCEPTION 'settlement_value_not_conserved';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id || E'\x1f' || p_hand_id, 0));

  SELECT * INTO v_existing
  FROM settlement_receipts
  WHERE tenant_id = p_tenant_id AND hand_id = p_hand_id;

  IF FOUND THEN
    IF v_existing.table_id <> p_table_id
       OR v_existing.epoch <> p_epoch
       OR v_existing.outcome_digest <> p_outcome_digest
       OR v_existing.settlement_digest <> p_settlement_digest
       OR v_existing.allocations <> p_allocations
       OR v_existing.verification_scheme <> 'dual-v1' THEN
      RAISE EXCEPTION 'settlement_receipt_conflict';
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO settlement_receipts(
    tenant_id, table_id, hand_id, epoch,
    outcome_digest, settlement_digest, allocations, verification_scheme
  ) VALUES (
    p_tenant_id, p_table_id, p_hand_id, p_epoch,
    p_outcome_digest, p_settlement_digest, p_allocations, 'dual-v1'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMIT;
