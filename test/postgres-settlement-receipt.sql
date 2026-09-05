\set ON_ERROR_STOP on

DO $$
DECLARE
  v_receipt bigint;
  v_replay bigint;
  v_other_tenant bigint;
  v_count bigint;
  v_allocations jsonb := '[{"accountId":"player:alice","deltaMinor":"2000"},{"accountId":"player:bob","deltaMinor":"-2000"}]'::jsonb;
BEGIN
  v_receipt := record_verified_settlement_receipt(
    'club-a', 'table-7', 'hand-00000001', 42,
    repeat('a', 64), repeat('b', 64), v_allocations
  );

  v_replay := record_verified_settlement_receipt(
    'club-a', 'table-7', 'hand-00000001', 42,
    repeat('a', 64), repeat('b', 64), v_allocations
  );

  IF v_replay <> v_receipt THEN
    RAISE EXCEPTION 'settlement_receipt_replay_created_duplicate';
  END IF;

  SELECT count(*) INTO v_count
  FROM settlement_receipts
  WHERE tenant_id = 'club-a' AND hand_id = 'hand-00000001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'settlement_receipt_idempotency_failed';
  END IF;

  BEGIN
    PERFORM record_verified_settlement_receipt(
      'club-a', 'table-7', 'hand-00000001', 42,
      repeat('c', 64), repeat('b', 64), v_allocations
    );
    RAISE EXCEPTION 'outcome_substitution_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'settlement_receipt_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM record_verified_settlement_receipt(
      'club-a', 'table-7', 'hand-00000001', 42,
      repeat('a', 64), repeat('d', 64), v_allocations
    );
    RAISE EXCEPTION 'settlement_digest_substitution_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'settlement_receipt_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM record_verified_settlement_receipt(
      'club-a', 'table-7', 'hand-noncanonical', 43,
      repeat('a', 64), repeat('e', 64),
      '[{"accountId":"player:bob","deltaMinor":"-1"},{"accountId":"player:alice","deltaMinor":"1"}]'::jsonb
    );
    RAISE EXCEPTION 'noncanonical_allocations_were_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'settlement_allocations_not_canonical' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM record_verified_settlement_receipt(
      'club-a', 'table-7', 'hand-unbalanced', 44,
      repeat('a', 64), repeat('f', 64),
      '[{"accountId":"player:alice","deltaMinor":"2"},{"accountId":"player:bob","deltaMinor":"-1"}]'::jsonb
    );
    RAISE EXCEPTION 'unbalanced_receipt_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'settlement_value_not_conserved' THEN RAISE; END IF;
  END;

  v_other_tenant := record_verified_settlement_receipt(
    'club-b', 'table-7', 'hand-00000001', 42,
    repeat('a', 64), repeat('b', 64), v_allocations
  );
  IF v_other_tenant = v_receipt THEN
    RAISE EXCEPTION 'tenant_scoped_receipt_identity_failed';
  END IF;

  BEGIN
    UPDATE settlement_receipts SET epoch = 99 WHERE id = v_receipt;
    RAISE EXCEPTION 'receipt_update_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'immutable_settlement_receipt' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM settlement_receipts WHERE id = v_receipt;
    RAISE EXCEPTION 'receipt_delete_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'immutable_settlement_receipt' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'settlement receipt evidence: idempotency=PASS outcome-binding=PASS canonical=PASS conservation=PASS append-only=PASS tenant-scope=PASS';
END;
$$;
