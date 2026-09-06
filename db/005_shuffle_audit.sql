BEGIN;

CREATE TABLE IF NOT EXISTS shuffle_manifests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  table_id text NOT NULL,
  hand_id text NOT NULL,
  game_id text NOT NULL,
  manifest_digest text NOT NULL UNIQUE,
  server_commitment text NOT NULL,
  participants jsonb NOT NULL,
  canonical_deck_digest text NOT NULL,
  deck_size smallint NOT NULL CHECK (deck_size BETWEEN 2 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(tenant_id) BETWEEN 1 AND 128 AND tenant_id ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(table_id) BETWEEN 1 AND 128 AND table_id ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(hand_id) BETWEEN 1 AND 128 AND hand_id ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (char_length(game_id) BETWEEN 1 AND 128 AND game_id ~ '^[A-Za-z0-9._:-]+$'),
  CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  CHECK (server_commitment ~ '^[0-9a-f]{64}$'),
  CHECK (canonical_deck_digest ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(participants) = 'array'),
  CHECK (jsonb_array_length(participants) BETWEEN 1 AND 32),
  UNIQUE (tenant_id, table_id, hand_id)
);

CREATE TABLE IF NOT EXISTS shuffle_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manifest_id bigint NOT NULL REFERENCES shuffle_manifests(id) ON DELETE RESTRICT,
  sequence smallint NOT NULL CHECK (sequence >= 0),
  event_type text NOT NULL CHECK (event_type IN ('deck_issued', 'aborted', 'disclosed')),
  deck_digest text,
  detail_digest text,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manifest_id, sequence),
  UNIQUE (manifest_id, event_type),
  CHECK (
    (event_type = 'deck_issued'
      AND deck_digest ~ '^[0-9a-f]{64}$'
      AND detail_digest IS NULL
      AND reason_code IS NULL)
    OR
    (event_type = 'aborted'
      AND deck_digest IS NULL
      AND detail_digest IS NULL
      AND reason_code ~ '^[a-z0-9][a-z0-9._:-]{0,63}$')
    OR
    (event_type = 'disclosed'
      AND deck_digest ~ '^[0-9a-f]{64}$'
      AND detail_digest ~ '^[0-9a-f]{64}$'
      AND reason_code IS NULL)
  )
);

CREATE OR REPLACE FUNCTION deny_shuffle_manifest_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_shuffle_manifest';
END;
$$;

DROP TRIGGER IF EXISTS shuffle_manifests_append_only ON shuffle_manifests;
CREATE TRIGGER shuffle_manifests_append_only
BEFORE UPDATE OR DELETE ON shuffle_manifests
FOR EACH ROW EXECUTE FUNCTION deny_shuffle_manifest_mutation();

CREATE OR REPLACE FUNCTION deny_shuffle_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_shuffle_audit_event';
END;
$$;

DROP TRIGGER IF EXISTS shuffle_audit_events_append_only ON shuffle_audit_events;
CREATE TRIGGER shuffle_audit_events_append_only
BEFORE UPDATE OR DELETE ON shuffle_audit_events
FOR EACH ROW EXECUTE FUNCTION deny_shuffle_audit_event_mutation();

CREATE OR REPLACE FUNCTION record_shuffle_manifest(
  p_tenant_id text,
  p_table_id text,
  p_hand_id text,
  p_game_id text,
  p_manifest_digest text,
  p_server_commitment text,
  p_participants jsonb,
  p_canonical_deck_digest text,
  p_deck_size smallint
)
RETURNS TABLE(status text, manifest_id bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing shuffle_manifests%ROWTYPE;
  v_digest_existing shuffle_manifests%ROWTYPE;
  v_id bigint;
  v_count integer;
  v_distinct_count integer;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_table_id IS NULL OR p_table_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_hand_id IS NULL OR p_hand_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_game_id IS NULL OR p_game_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'shuffle_manifest_invalid_identity';
  END IF;
  IF p_manifest_digest IS NULL OR p_manifest_digest !~ '^[0-9a-f]{64}$'
     OR p_server_commitment IS NULL OR p_server_commitment !~ '^[0-9a-f]{64}$'
     OR p_canonical_deck_digest IS NULL OR p_canonical_deck_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'shuffle_manifest_invalid_digest';
  END IF;
  IF p_deck_size IS NULL OR p_deck_size < 2 OR p_deck_size > 512 THEN
    RAISE EXCEPTION 'shuffle_manifest_invalid_deck_size';
  END IF;
  IF p_participants IS NULL OR jsonb_typeof(p_participants) <> 'array'
     OR jsonb_array_length(p_participants) < 1 OR jsonb_array_length(p_participants) > 32 THEN
    RAISE EXCEPTION 'shuffle_manifest_invalid_participants';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_participants) AS participant
    WHERE jsonb_typeof(participant) <> 'object'
       OR COALESCE(participant->>'id', '') !~ '^[A-Za-z0-9._:-]{1,128}$'
       OR COALESCE(participant->>'commitment', '') !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'shuffle_manifest_invalid_participant';
  END IF;
  SELECT count(*), count(DISTINCT participant->>'id')
    INTO v_count, v_distinct_count
    FROM jsonb_array_elements(p_participants) AS participant;
  IF v_count <> v_distinct_count THEN
    RAISE EXCEPTION 'shuffle_manifest_duplicate_participant';
  END IF;

  -- Serialize one shuffle lifecycle per tenant/table/hand before reveals are consumed.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_table_id || ':' || p_hand_id, 0));

  SELECT * INTO v_existing
  FROM shuffle_manifests
  WHERE tenant_id=p_tenant_id AND table_id=p_table_id AND hand_id=p_hand_id;
  IF FOUND THEN
    IF v_existing.game_id <> p_game_id
       OR v_existing.manifest_digest <> p_manifest_digest
       OR v_existing.server_commitment <> p_server_commitment
       OR v_existing.participants <> p_participants
       OR v_existing.canonical_deck_digest <> p_canonical_deck_digest
       OR v_existing.deck_size <> p_deck_size THEN
      RAISE EXCEPTION 'shuffle_manifest_conflict';
    END IF;
    RETURN QUERY SELECT 'replay'::text, v_existing.id;
    RETURN;
  END IF;

  SELECT * INTO v_digest_existing
  FROM shuffle_manifests
  WHERE manifest_digest=p_manifest_digest;
  IF FOUND THEN
    RAISE EXCEPTION 'shuffle_manifest_digest_reuse';
  END IF;

  INSERT INTO shuffle_manifests(
    tenant_id, table_id, hand_id, game_id, manifest_digest, server_commitment,
    participants, canonical_deck_digest, deck_size
  ) VALUES (
    p_tenant_id, p_table_id, p_hand_id, p_game_id, p_manifest_digest, p_server_commitment,
    p_participants, p_canonical_deck_digest, p_deck_size
  ) RETURNING id INTO v_id;

  RETURN QUERY SELECT 'recorded'::text, v_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_shuffle_audit_event(
  p_manifest_digest text,
  p_event_type text,
  p_deck_digest text,
  p_detail_digest text,
  p_reason_code text
)
RETURNS TABLE(status text, event_id bigint, sequence smallint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_manifest shuffle_manifests%ROWTYPE;
  v_existing shuffle_audit_events%ROWTYPE;
  v_issued shuffle_audit_events%ROWTYPE;
  v_has_aborted boolean;
  v_has_disclosed boolean;
  v_id bigint;
  v_sequence smallint;
  v_status text;
BEGIN
  IF p_manifest_digest IS NULL OR p_manifest_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'shuffle_event_invalid_manifest_digest';
  END IF;
  IF p_event_type NOT IN ('deck_issued', 'aborted', 'disclosed') THEN
    RAISE EXCEPTION 'shuffle_event_invalid_type';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_manifest_digest, 0));

  SELECT * INTO v_manifest FROM shuffle_manifests WHERE manifest_digest=p_manifest_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shuffle_event_manifest_not_persisted';
  END IF;

  SELECT * INTO v_existing
  FROM shuffle_audit_events
  WHERE manifest_id=v_manifest.id AND event_type=p_event_type;
  IF FOUND THEN
    IF v_existing.deck_digest IS DISTINCT FROM p_deck_digest
       OR v_existing.detail_digest IS DISTINCT FROM p_detail_digest
       OR v_existing.reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'shuffle_event_conflict';
    END IF;
    RETURN QUERY SELECT 'replay'::text, v_existing.id, v_existing.sequence;
    RETURN;
  END IF;

  SELECT * INTO v_issued
  FROM shuffle_audit_events
  WHERE manifest_id=v_manifest.id AND event_type='deck_issued';
  SELECT EXISTS(
    SELECT 1 FROM shuffle_audit_events WHERE manifest_id=v_manifest.id AND event_type='aborted'
  ) INTO v_has_aborted;
  SELECT EXISTS(
    SELECT 1 FROM shuffle_audit_events WHERE manifest_id=v_manifest.id AND event_type='disclosed'
  ) INTO v_has_disclosed;

  IF p_event_type='deck_issued' THEN
    IF v_has_aborted OR v_has_disclosed OR v_issued.id IS NOT NULL THEN
      RAISE EXCEPTION 'shuffle_deck_issue_invalid_state';
    END IF;
    IF p_deck_digest IS NULL OR p_deck_digest !~ '^[0-9a-f]{64}$'
       OR p_detail_digest IS NOT NULL OR p_reason_code IS NOT NULL THEN
      RAISE EXCEPTION 'shuffle_deck_issue_invalid_payload';
    END IF;
    v_sequence := 0;
    v_status := 'issued';
  ELSIF p_event_type='aborted' THEN
    IF v_issued.id IS NOT NULL OR v_has_disclosed OR v_has_aborted THEN
      RAISE EXCEPTION 'shuffle_abort_invalid_state';
    END IF;
    IF p_deck_digest IS NOT NULL OR p_detail_digest IS NOT NULL
       OR p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{0,63}$' THEN
      RAISE EXCEPTION 'shuffle_abort_invalid_payload';
    END IF;
    v_sequence := 0;
    v_status := 'aborted';
  ELSE
    IF v_issued.id IS NULL OR v_has_aborted OR v_has_disclosed THEN
      RAISE EXCEPTION 'shuffle_disclosure_invalid_state';
    END IF;
    IF p_deck_digest IS NULL OR p_deck_digest !~ '^[0-9a-f]{64}$'
       OR p_deck_digest <> v_issued.deck_digest
       OR p_detail_digest IS NULL OR p_detail_digest !~ '^[0-9a-f]{64}$'
       OR p_reason_code IS NOT NULL THEN
      RAISE EXCEPTION 'shuffle_disclosure_invalid_payload';
    END IF;
    v_sequence := 1;
    v_status := 'disclosed';
  END IF;

  INSERT INTO shuffle_audit_events(
    manifest_id, sequence, event_type, deck_digest, detail_digest, reason_code
  ) VALUES (
    v_manifest.id, v_sequence, p_event_type, p_deck_digest, p_detail_digest, p_reason_code
  ) RETURNING id INTO v_id;

  RETURN QUERY SELECT v_status, v_id, v_sequence;
END;
$$;

COMMIT;
