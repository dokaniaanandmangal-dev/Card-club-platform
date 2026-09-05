\set ON_ERROR_STOP on

DO $$
DECLARE
  v_first bigint;
  v_replay bigint;
  v_second bigint;
BEGIN
  SELECT outcome_id INTO v_first FROM record_game_outcome(
    'club-game-sql','table-1','hand-1',1,0,NULL,repeat('a',64)
  );
  SELECT outcome_id INTO v_replay FROM record_game_outcome(
    'club-game-sql','table-1','hand-1',1,0,NULL,repeat('a',64)
  );
  IF v_replay <> v_first THEN RAISE EXCEPTION 'game_outcome_replay_failed'; END IF;

  BEGIN
    PERFORM record_game_outcome('club-game-sql','table-1','hand-1',1,0,NULL,repeat('b',64));
    RAISE EXCEPTION 'game_outcome_conflict_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'game_outcome_conflict' THEN RAISE; END IF;
  END;

  SELECT outcome_id INTO v_second FROM record_game_outcome(
    'club-game-sql','table-1','hand-2',1,1,repeat('a',64),repeat('b',64)
  );
  IF v_second = v_first THEN RAISE EXCEPTION 'game_outcome_second_id_invalid'; END IF;

  BEGIN
    PERFORM record_game_outcome('club-game-sql','table-1','hand-3',1,3,repeat('b',64),repeat('c',64));
    RAISE EXCEPTION 'game_outcome_sequence_gap_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'game_outcome_sequence_gap' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM record_game_outcome('club-game-sql','table-1','hand-3',1,2,repeat('f',64),repeat('c',64));
    RAISE EXCEPTION 'game_outcome_bad_previous_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'game_outcome_previous_digest_mismatch' THEN RAISE; END IF;
  END;

  PERFORM record_game_outcome('club-game-sql','table-2','hand-x',1,0,NULL,repeat('d',64));

  BEGIN
    UPDATE game_outcomes SET outcome_digest=repeat('e',64) WHERE id=v_first;
    RAISE EXCEPTION 'game_outcome_update_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'append_only_game_outcome' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM game_outcomes WHERE id=v_first;
    RAISE EXCEPTION 'game_outcome_delete_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'append_only_game_outcome' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'game outcome persistence evidence: append-only=PASS replay=PASS chain=PASS table-isolation=PASS';
END;
$$;
