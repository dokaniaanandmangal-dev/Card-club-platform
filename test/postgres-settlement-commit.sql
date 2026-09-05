\set ON_ERROR_STOP on

DO $$
DECLARE
  v_clearing bigint;
  v_alice bigint;
  v_bob bigint;
  v_status text;
  v_receipt bigint;
  v_tx_count integer;
  v_balance numeric;
  v_allocations jsonb := '[{"accountId":"player:alice","deltaMinor":"2000"},{"accountId":"player:bob","deltaMinor":"-2000"}]'::jsonb;
BEGIN
  INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ('club-settle', 'system:clearing') RETURNING id INTO v_clearing;
  INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ('club-settle', 'player:alice') RETURNING id INTO v_alice;
  INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ('club-settle', 'player:bob') RETURNING id INTO v_bob;

  -- Test fixture funding represents an already-authorized upstream credit flow;
  -- the v2.1 game-settlement gate itself neither mints nor burns value.
  PERFORM apply_ledger_transfer('club-settle', 'fund-bob-0001', 1, v_clearing, v_bob, 7000);
  PERFORM apply_ledger_transfer('club-settle', 'fund-alice-001', 1, v_clearing, v_alice, 3000);

  SELECT status, receipt_id, transaction_count
    INTO v_status, v_receipt, v_tx_count
  FROM commit_verified_settlement(
    'club-settle', 'table-1', 'hand-settle-0001', 1,
    repeat('a', 64), repeat('b', 64), v_allocations, 2
  );

  IF v_status <> 'applied' OR v_tx_count <> 1 THEN
    RAISE EXCEPTION 'settlement_commit_failed:%:%', v_status, v_tx_count;
  END IF;

  SELECT COALESCE(sum(amount_minor), 0) INTO v_balance FROM ledger_entries WHERE tenant_id='club-settle' AND account_id=v_alice;
  IF v_balance <> 5000 THEN RAISE EXCEPTION 'alice_custody_wrong:%', v_balance; END IF;
  SELECT COALESCE(sum(amount_minor), 0) INTO v_balance FROM ledger_entries WHERE tenant_id='club-settle' AND account_id=v_bob;
  IF v_balance <> 5000 THEN RAISE EXCEPTION 'bob_custody_wrong:%', v_balance; END IF;

  IF (SELECT count(*) FROM settlement_ledger_transactions WHERE receipt_id=v_receipt) <> 1 THEN
    RAISE EXCEPTION 'settlement_ledger_link_missing';
  END IF;

  PERFORM lock_ledger_fence('club-settle', 3);

  SELECT status, receipt_id, transaction_count
    INTO v_status, v_receipt, v_tx_count
  FROM commit_verified_settlement(
    'club-settle', 'table-1', 'hand-settle-0001', 1,
    repeat('a', 64), repeat('b', 64), v_allocations, 2
  );
  IF v_status <> 'replay' OR v_tx_count <> 1 THEN
    RAISE EXCEPTION 'committed_replay_failed:%:%', v_status, v_tx_count;
  END IF;

  BEGIN
    PERFORM commit_verified_settlement(
      'club-settle', 'table-1', 'hand-insufficient', 2,
      repeat('c', 64), repeat('d', 64),
      '[{"accountId":"player:alice","deltaMinor":"6000"},{"accountId":"player:bob","deltaMinor":"-6000"}]'::jsonb,
      3
    );
    RAISE EXCEPTION 'insufficient_custody_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'insufficient_custody:player:bob' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM settlement_receipts WHERE tenant_id='club-settle' AND hand_id='hand-insufficient') THEN
    RAISE EXCEPTION 'failed_settlement_receipt_persisted';
  END IF;
END;
$$;

-- Crash/retry evidence: receipt, journal rows and commit marker are one database
-- transaction. A rollback leaves no durable partial settlement.
BEGIN;
SELECT * FROM commit_verified_settlement(
  'club-settle', 'table-1', 'hand-crash-retry', 3,
  repeat('e', 64), repeat('f', 64),
  '[{"accountId":"player:alice","deltaMinor":"-500"},{"accountId":"player:bob","deltaMinor":"500"}]'::jsonb,
  3
);
ROLLBACK;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM settlement_receipts WHERE tenant_id='club-settle' AND hand_id='hand-crash-retry') THEN
    RAISE EXCEPTION 'rolled_back_receipt_persisted';
  END IF;
  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE tenant_id='club-settle' AND operation_id LIKE 'settle:' || repeat('f',64) || ':%') THEN
    RAISE EXCEPTION 'rolled_back_ledger_transaction_persisted';
  END IF;
END;
$$;

SELECT * FROM commit_verified_settlement(
  'club-settle', 'table-1', 'hand-crash-retry', 3,
  repeat('e', 64), repeat('f', 64),
  '[{"accountId":"player:alice","deltaMinor":"-500"},{"accountId":"player:bob","deltaMinor":"500"}]'::jsonb,
  3
);

DO $$
DECLARE
  v_clearing bigint;
  v_alice bigint;
  v_bob bigint;
  v_carol bigint;
  v_status text;
  v_receipt bigint;
  v_tx_count integer;
  v_balance numeric;
BEGIN
  SELECT id INTO v_clearing FROM ledger_accounts WHERE tenant_id='club-settle' AND account_code='system:clearing';
  SELECT id INTO v_alice FROM ledger_accounts WHERE tenant_id='club-settle' AND account_code='player:alice';
  SELECT id INTO v_bob FROM ledger_accounts WHERE tenant_id='club-settle' AND account_code='player:bob';

  SELECT COALESCE(sum(amount_minor),0) INTO v_balance FROM ledger_entries WHERE tenant_id='club-settle' AND account_id=v_alice;
  IF v_balance <> 4500 THEN RAISE EXCEPTION 'crash_retry_alice_wrong:%', v_balance; END IF;
  SELECT COALESCE(sum(amount_minor),0) INTO v_balance FROM ledger_entries WHERE tenant_id='club-settle' AND account_id=v_bob;
  IF v_balance <> 5500 THEN RAISE EXCEPTION 'crash_retry_bob_wrong:%', v_balance; END IF;

  BEGIN
    PERFORM commit_verified_settlement(
      'club-settle', 'table-1', 'hand-crash-retry', 3,
      repeat('0', 64), repeat('f', 64),
      '[{"accountId":"player:alice","deltaMinor":"-500"},{"accountId":"player:bob","deltaMinor":"500"}]'::jsonb,
      3
    );
    RAISE EXCEPTION 'committed_outcome_tamper_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'settlement_receipt_conflict' THEN RAISE; END IF;
  END;

  INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ('club-settle', 'player:carol') RETURNING id INTO v_carol;
  PERFORM apply_ledger_transfer('club-settle', 'fund-carol-0001', 4, v_clearing, v_carol, 1000);

  SELECT status, receipt_id, transaction_count
    INTO v_status, v_receipt, v_tx_count
  FROM commit_verified_settlement(
    'club-settle', 'table-1', 'hand-multi-party', 4,
    repeat('1', 64), repeat('9', 64),
    '[{"accountId":"player:alice","deltaMinor":"-300"},{"accountId":"player:bob","deltaMinor":"-200"},{"accountId":"player:carol","deltaMinor":"500"}]'::jsonb,
    4
  );

  IF v_status <> 'applied' OR v_tx_count <> 2 THEN
    RAISE EXCEPTION 'multi_party_decomposition_failed:%:%', v_status, v_tx_count;
  END IF;

  IF (SELECT count(*) FROM settlement_ledger_transactions WHERE receipt_id=v_receipt) <> 2 THEN
    RAISE EXCEPTION 'multi_party_ledger_links_wrong';
  END IF;

  SELECT COALESCE(sum(amount_minor),0) INTO v_balance FROM ledger_entries WHERE tenant_id='club-settle' AND account_id=v_alice;
  IF v_balance <> 4200 THEN RAISE EXCEPTION 'multi_party_alice_wrong:%', v_balance; END IF;
  SELECT COALESCE(sum(amount_minor),0) INTO v_balance FROM ledger_entries WHERE tenant_id='club-settle' AND account_id=v_bob;
  IF v_balance <> 5300 THEN RAISE EXCEPTION 'multi_party_bob_wrong:%', v_balance; END IF;
  SELECT COALESCE(sum(amount_minor),0) INTO v_balance FROM ledger_entries WHERE tenant_id='club-settle' AND account_id=v_carol;
  IF v_balance <> 1500 THEN RAISE EXCEPTION 'multi_party_carol_wrong:%', v_balance; END IF;

  BEGIN
    UPDATE settlement_commits SET transaction_count=99 WHERE receipt_id=v_receipt;
    RAISE EXCEPTION 'settlement_commit_mutation_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'immutable_settlement_commit' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'settlement commit evidence: dual-gate=PASS atomicity=PASS retry=PASS custody=PASS multi-party=PASS tamper=PASS append-only=PASS';
END;
$$;
