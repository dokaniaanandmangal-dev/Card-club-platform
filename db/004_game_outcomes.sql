BEGIN;

CREATE TABLE IF NOT EXISTS game_outcomes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  table_id text NOT NULL,
  hand_id text NOT NULL,
  epoch bigint NOT NULL CHECK (epoch >= 0),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  previous_outcome_digest text,
  outcome_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome_digest ~ '^[0-9a-f]{64}$'),
  CHECK (
    (sequence = 0 AND previous_outcome_digest IS NULL)
    OR (sequence > 0 AND previous_outcome_digest ~ '^[0-9a-f]{64}$')
  ),
  UNIQUE (tenant_id, table_id, hand_id),
  UNIQUE (tenant_id, table_id, sequence),
  UNIQUE (tenant_id, table_id, outcome_digest)
);

CREATE OR REPLACE FUNCTION deny_game_outcome_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_game_outcome';
END;
$$;

DROP TRIGGER IF EXISTS game_outcomes_append_only ON game_outcomes;
CREATE TRIGGER game_outcomes_append_only
BEFORE UPDATE OR DELETE ON game_outcomes
FOR EACH ROW EXECUTE FUNCTION deny_game_outcome_mutation();

CREATE OR REPLACE FUNCTION record_game_outcome(
  p_tenant_id text,
  p_table_id text,
  p_hand_id text,
  p_epoch bigint,
  p_sequence bigint,
  p_previous_outcome_digest text,
  p_outcome_digest text
)
RETURNS TABLE(status text, outcome_id bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing game_outcomes%ROWTYPE;
  v_latest game_outcomes%ROWTYPE;
  v_id bigint;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id = '' OR p_table_id IS NULL OR p_table_id = '' OR p_hand_id IS NULL OR p_hand_id = '' THEN
    RAISE EXCEPTION 'game_outcome_invalid_identity';
  END IF;
  IF p_epoch IS NULL OR p_epoch < 0 OR p_sequence IS NULL OR p_sequence < 0 THEN
    RAISE EXCEPTION 'game_outcome_invalid_sequence';
  END IF;
  IF p_outcome_digest IS NULL OR p_outcome_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'game_outcome_invalid_digest';
  END IF;
  IF (p_sequence = 0 AND p_previous_outcome_digest IS NOT NULL)
     OR (p_sequence > 0 AND (p_previous_outcome_digest IS NULL OR p_previous_outcome_digest !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'game_outcome_invalid_previous_digest';
  END IF;

  -- Serialize one authoritative outcome chain per tenant/table.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_table_id, 0));

  SELECT * INTO v_existing FROM game_outcomes
  WHERE tenant_id=p_tenant_id AND table_id=p_table_id AND hand_id=p_hand_id;
  IF FOUND THEN
    IF v_existing.epoch <> p_epoch OR v_existing.sequence <> p_sequence
       OR v_existing.previous_outcome_digest IS DISTINCT FROM p_previous_outcome_digest
       OR v_existing.outcome_digest <> p_outcome_digest THEN
      RAISE EXCEPTION 'game_outcome_conflict';
    END IF;
    RETURN QUERY SELECT 'replay'::text, v_existing.id;
    RETURN;
  END IF;

  SELECT * INTO v_latest FROM game_outcomes
  WHERE tenant_id=p_tenant_id AND table_id=p_table_id
  ORDER BY sequence DESC LIMIT 1;

  IF NOT FOUND THEN
    IF p_sequence <> 0 OR p_previous_outcome_digest IS NOT NULL THEN
      RAISE EXCEPTION 'game_outcome_chain_must_start_at_zero';
    END IF;
  ELSE
    IF p_sequence <> v_latest.sequence + 1 THEN
      RAISE EXCEPTION 'game_outcome_sequence_gap';
    END IF;
    IF p_previous_outcome_digest <> v_latest.outcome_digest THEN
      RAISE EXCEPTION 'game_outcome_previous_digest_mismatch';
    END IF;
  END IF;

  INSERT INTO game_outcomes(tenant_id,table_id,hand_id,epoch,sequence,previous_outcome_digest,outcome_digest)
  VALUES(p_tenant_id,p_table_id,p_hand_id,p_epoch,p_sequence,p_previous_outcome_digest,p_outcome_digest)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT 'recorded'::text, v_id;
END;
$$;

COMMIT;
