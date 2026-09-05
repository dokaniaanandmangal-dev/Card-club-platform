\set ON_ERROR_STOP on

DO $$
DECLARE
  v_a_debit bigint;
  v_a_credit bigint;
  v_b_account bigint;
  v_tx1 bigint;
  v_tx1_replay bigint;
  v_tx2 bigint;
  v_count bigint;
  v_sum bigint;
  v_fence bigint;
BEGIN
  INSERT INTO ledger_accounts (tenant_id, account_code)
  VALUES ('club-a', 'player:alice')
  RETURNING id INTO v_a_debit;

  INSERT INTO ledger_accounts (tenant_id, account_code)
  VALUES ('club-a', 'table:escrow')
  RETURNING id INTO v_a_credit;

  INSERT INTO ledger_accounts (tenant_id, account_code)
  VALUES ('club-b', 'player:bob')
  RETURNING id INTO v_b_account;

  v_tx1 := apply_ledger_transfer(
    'club-a', 'operation-0001', 10, v_a_debit, v_a_credit, 2500
  );

  v_tx1_replay := apply_ledger_transfer(
    'club-a', 'operation-0001', 10, v_a_debit, v_a_credit, 2500
  );

  IF v_tx1_replay <> v_tx1 THEN
    RAISE EXCEPTION 'replay_created_new_transaction';
  END IF;

  SELECT count(*) INTO v_count
  FROM ledger_transactions
  WHERE tenant_id = 'club-a' AND operation_id = 'operation-0001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'idempotency_failed';
  END IF;

  SELECT count(*), sum(amount_minor)
  INTO v_count, v_sum
  FROM ledger_entries
  WHERE transaction_id = v_tx1;
  IF v_count <> 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'double_entry_balance_failed';
  END IF;

  v_tx2 := apply_ledger_transfer(
    'club-a', 'operation-0002', 11, v_a_credit, v_a_debit, 500
  );

  -- An exact replay remains harmless even after a newer fence token wins.
  v_tx1_replay := apply_ledger_transfer(
    'club-a', 'operation-0001', 10, v_a_debit, v_a_credit, 2500
  );
  IF v_tx1_replay <> v_tx1 THEN
    RAISE EXCEPTION 'historical_replay_failed';
  END IF;

  BEGIN
    PERFORM apply_ledger_transfer(
      'club-a', 'operation-stale', 10, v_a_debit, v_a_credit, 100
    );
    RAISE EXCEPTION 'stale_fence_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'stale_fence' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM apply_ledger_transfer(
      'club-a', 'operation-0001', 10, v_a_debit, v_a_credit, 2600
    );
    RAISE EXCEPTION 'operation_id_conflict_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'operation_id_conflict' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM apply_ledger_transfer(
      'club-a', 'operation-cross-tenant', 11, v_a_debit, v_b_account, 100
    );
    RAISE EXCEPTION 'cross_tenant_account_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'account_tenant_mismatch' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE ledger_transactions SET amount_minor = 1 WHERE id = v_tx1;
    RAISE EXCEPTION 'transaction_mutation_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'append_only_ledger' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM ledger_entries WHERE transaction_id = v_tx1;
    RAISE EXCEPTION 'entry_deletion_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'append_only_ledger' THEN
      RAISE;
    END IF;
  END;

  SELECT count(*) INTO v_count FROM ledger_transactions WHERE tenant_id = 'club-a';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'unexpected_transaction_count:%', v_count;
  END IF;

  SELECT COALESCE(sum(amount_minor), 0) INTO v_sum
  FROM ledger_entries e
  JOIN ledger_transactions t ON t.id = e.transaction_id
  WHERE t.tenant_id = 'club-a';
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'tenant_ledger_not_balanced:%', v_sum;
  END IF;

  SELECT max_token INTO v_fence FROM ledger_fence WHERE tenant_id = 'club-a';
  IF v_fence <> 11 THEN
    RAISE EXCEPTION 'fence_did_not_advance:%', v_fence;
  END IF;

  RAISE NOTICE 'postgres ledger evidence: idempotency=PASS fencing=PASS tenant-isolation=PASS append-only=PASS double-entry=PASS';
END;
$$;
