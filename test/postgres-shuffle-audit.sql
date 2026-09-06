\set ON_ERROR_STOP on

DO $$
DECLARE
  r record;
  participant_json jsonb := jsonb_build_array(
    jsonb_build_object('id','alice','commitment',repeat('c',64)),
    jsonb_build_object('id','bob','commitment',repeat('d',64))
  );
BEGIN
  SELECT * INTO r FROM record_shuffle_manifest(
    'tenant-a','table-1','hand-abort','teen-patti',repeat('a',64),repeat('b',64),
    participant_json,repeat('e',64),52
  );
  IF r.status <> 'recorded' THEN RAISE EXCEPTION 'expected recorded manifest'; END IF;

  SELECT * INTO r FROM record_shuffle_manifest(
    'tenant-a','table-1','hand-abort','teen-patti',repeat('a',64),repeat('b',64),
    participant_json,repeat('e',64),52
  );
  IF r.status <> 'replay' THEN RAISE EXCEPTION 'expected manifest replay'; END IF;

  BEGIN
    PERFORM 1 FROM record_shuffle_manifest(
      'tenant-a','table-1','hand-abort','teen-patti',repeat('a',64),repeat('b',64),
      participant_json,repeat('f',64),52
    );
    RAISE EXCEPTION 'assertion_failed_manifest_conflict';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'assertion_failed_manifest_conflict' THEN RAISE; END IF;
    IF position('shuffle_manifest_conflict' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT * INTO r FROM record_shuffle_audit_event(repeat('a',64),'aborted',NULL,NULL,'participant_reveal_timeout');
  IF r.status <> 'aborted' OR r.sequence <> 0 THEN RAISE EXCEPTION 'expected durable abort'; END IF;

  SELECT * INTO r FROM record_shuffle_audit_event(repeat('a',64),'aborted',NULL,NULL,'participant_reveal_timeout');
  IF r.status <> 'replay' THEN RAISE EXCEPTION 'expected abort replay'; END IF;

  BEGIN
    PERFORM 1 FROM record_shuffle_audit_event(repeat('a',64),'deck_issued',repeat('1',64),NULL,NULL);
    RAISE EXCEPTION 'assertion_failed_issue_after_abort';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'assertion_failed_issue_after_abort' THEN RAISE; END IF;
    IF position('shuffle_deck_issue_invalid_state' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

DO $$
DECLARE
  r record;
  participant_json jsonb := jsonb_build_array(
    jsonb_build_object('id','alice','commitment',repeat('4',64)),
    jsonb_build_object('id','bob','commitment',repeat('5',64))
  );
BEGIN
  SELECT * INTO r FROM record_shuffle_manifest(
    'tenant-a','table-1','hand-issued','holdem',repeat('6',64),repeat('7',64),
    participant_json,repeat('8',64),52
  );
  IF r.status <> 'recorded' THEN RAISE EXCEPTION 'expected second manifest'; END IF;

  SELECT * INTO r FROM record_shuffle_audit_event(repeat('6',64),'deck_issued',repeat('9',64),NULL,NULL);
  IF r.status <> 'issued' OR r.sequence <> 0 THEN RAISE EXCEPTION 'expected deck issued'; END IF;

  SELECT * INTO r FROM record_shuffle_audit_event(repeat('6',64),'deck_issued',repeat('9',64),NULL,NULL);
  IF r.status <> 'replay' THEN RAISE EXCEPTION 'expected deck issue replay'; END IF;

  BEGIN
    PERFORM 1 FROM record_shuffle_audit_event(repeat('6',64),'aborted',NULL,NULL,'server_cancelled');
    RAISE EXCEPTION 'assertion_failed_abort_after_issue';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'assertion_failed_abort_after_issue' THEN RAISE; END IF;
    IF position('shuffle_abort_invalid_state' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM 1 FROM record_shuffle_audit_event(repeat('6',64),'disclosed',repeat('0',64),repeat('2',64),NULL);
    RAISE EXCEPTION 'assertion_failed_wrong_disclosure_deck';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'assertion_failed_wrong_disclosure_deck' THEN RAISE; END IF;
    IF position('shuffle_disclosure_invalid_payload' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT * INTO r FROM record_shuffle_audit_event(repeat('6',64),'disclosed',repeat('9',64),repeat('2',64),NULL);
  IF r.status <> 'disclosed' OR r.sequence <> 1 THEN RAISE EXCEPTION 'expected disclosure'; END IF;

  SELECT * INTO r FROM record_shuffle_audit_event(repeat('6',64),'disclosed',repeat('9',64),repeat('2',64),NULL);
  IF r.status <> 'replay' THEN RAISE EXCEPTION 'expected disclosure replay'; END IF;

  BEGIN
    PERFORM 1 FROM record_shuffle_audit_event(repeat('6',64),'disclosed',repeat('9',64),repeat('3',64),NULL);
    RAISE EXCEPTION 'assertion_failed_disclosure_conflict';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'assertion_failed_disclosure_conflict' THEN RAISE; END IF;
    IF position('shuffle_event_conflict' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  -- Same table/hand identity is isolated by tenant.
  SELECT * INTO r FROM record_shuffle_manifest(
    'tenant-b','table-1','hand-issued','holdem',repeat('f',64),repeat('e',64),
    jsonb_build_array(jsonb_build_object('id','carol','commitment',repeat('d',64))),
    repeat('c',64),52
  );
  IF r.status <> 'recorded' THEN RAISE EXCEPTION 'expected tenant-isolated manifest'; END IF;

  IF (SELECT count(*) FROM shuffle_manifests WHERE table_id='table-1' AND hand_id='hand-issued') <> 2 THEN
    RAISE EXCEPTION 'tenant isolation evidence failed';
  END IF;

  IF (SELECT count(*) FROM shuffle_audit_events e JOIN shuffle_manifests m ON m.id=e.manifest_id WHERE m.manifest_digest=repeat('6',64)) <> 2 THEN
    RAISE EXCEPTION 'issued/disclosed event count mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('shuffle_manifests','shuffle_audit_events')
      AND column_name ILIKE '%seed%'
  ) THEN
    RAISE EXCEPTION 'live shuffle audit tables must not persist plaintext reveal seeds';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE shuffle_manifests SET game_id='tampered' WHERE manifest_digest=repeat('6',64);
    RAISE EXCEPTION 'assertion_failed_manifest_update';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'assertion_failed_manifest_update' THEN RAISE; END IF;
    IF position('append_only_shuffle_manifest' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM shuffle_audit_events
    WHERE manifest_id=(SELECT id FROM shuffle_manifests WHERE manifest_digest=repeat('6',64))
      AND event_type='deck_issued';
    RAISE EXCEPTION 'assertion_failed_event_delete';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'assertion_failed_event_delete' THEN RAISE; END IF;
    IF position('append_only_shuffle_audit_event' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

SELECT 'shuffle audit persistence evidence: ok' AS result;
