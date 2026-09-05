BEGIN;

CREATE TABLE IF NOT EXISTS settlement_ledger_transactions (
  receipt_id bigint NOT NULL REFERENCES settlement_receipts(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  transaction_id bigint NOT NULL UNIQUE REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  PRIMARY KEY (receipt_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS settlement_commits (
  receipt_id bigint PRIMARY KEY REFERENCES settlement_receipts(id) ON DELETE RESTRICT,
  transaction_count integer NOT NULL CHECK (transaction_count >= 0),
  committed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION deny_settlement_commit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_settlement_commit';
END;
$$;

DROP TRIGGER IF EXISTS settlement_ledger_transactions_append_only ON settlement_ledger_transactions;
CREATE TRIGGER settlement_ledger_transactions_append_only
BEFORE UPDATE OR DELETE ON settlement_ledger_transactions
FOR EACH ROW EXECUTE FUNCTION deny_settlement_commit_mutation();

DROP TRIGGER IF EXISTS settlement_commits_append_only ON settlement_commits;
CREATE TRIGGER settlement_commits_append_only
BEFORE UPDATE OR DELETE ON settlement_commits
FOR EACH ROW EXECUTE FUNCTION deny_settlement_commit_mutation();

CREATE OR REPLACE FUNCTION lock_ledger_fence(p_tenant_id text, p_fence_token bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_fence bigint;
BEGIN
  IF p_tenant_id IS NULL OR length(p_tenant_id) = 0 THEN
    RAISE EXCEPTION 'invalid_tenant';
  END IF;
  IF p_fence_token IS NULL OR p_fence_token < 0 THEN
    RAISE EXCEPTION 'invalid_fence_token';
  END IF;

  INSERT INTO ledger_fence (tenant_id, max_token)
  VALUES (p_tenant_id, p_fence_token)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT max_token INTO v_current_fence
  FROM ledger_fence
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF p_fence_token < v_current_fence THEN
    RAISE EXCEPTION 'stale_fence';
  END IF;

  IF p_fence_token > v_current_fence THEN
    UPDATE ledger_fence
    SET max_token = p_fence_token, updated_at = now()
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION apply_ledger_transfer(
  p_tenant_id text,
  p_operation_id text,
  p_fence_token bigint,
  p_debit_account_id bigint,
  p_credit_account_id bigint,
  p_amount_minor bigint
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing ledger_transactions%ROWTYPE;
  v_transaction_id bigint;
BEGIN
  IF p_tenant_id IS NULL OR length(p_tenant_id) = 0 THEN
    RAISE EXCEPTION 'invalid_tenant';
  END IF;
  IF p_operation_id IS NULL OR length(p_operation_id) < 8 OR length(p_operation_id) > 128 THEN
    RAISE EXCEPTION 'invalid_operation_id';
  END IF;
  IF p_fence_token IS NULL OR p_fence_token < 0 THEN
    RAISE EXCEPTION 'invalid_fence_token';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF p_debit_account_id = p_credit_account_id THEN
    RAISE EXCEPTION 'same_account_transfer';
  END IF;

  SELECT * INTO v_existing
  FROM ledger_transactions
  WHERE tenant_id = p_tenant_id AND operation_id = p_operation_id;

  IF FOUND THEN
    IF v_existing.fence_token <> p_fence_token
       OR v_existing.debit_account_id <> p_debit_account_id
       OR v_existing.credit_account_id <> p_credit_account_id
       OR v_existing.amount_minor <> p_amount_minor THEN
      RAISE EXCEPTION 'operation_id_conflict';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ledger_accounts
    WHERE tenant_id = p_tenant_id AND id = p_debit_account_id
  ) OR NOT EXISTS (
    SELECT 1 FROM ledger_accounts
    WHERE tenant_id = p_tenant_id AND id = p_credit_account_id
  ) THEN
    RAISE EXCEPTION 'account_tenant_mismatch';
  END IF;

  PERFORM lock_ledger_fence(p_tenant_id, p_fence_token);

  -- Every value mutation uses the same lock order: tenant fence first, then
  -- involved account rows by numeric ID. Settlement custody checks rely on
  -- this to prevent a concurrent transfer from changing an account between
  -- balance verification and journal insertion.
  PERFORM id
  FROM ledger_accounts
  WHERE tenant_id = p_tenant_id
    AND id IN (p_debit_account_id, p_credit_account_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_existing
  FROM ledger_transactions
  WHERE tenant_id = p_tenant_id AND operation_id = p_operation_id;

  IF FOUND THEN
    IF v_existing.fence_token <> p_fence_token
       OR v_existing.debit_account_id <> p_debit_account_id
       OR v_existing.credit_account_id <> p_credit_account_id
       OR v_existing.amount_minor <> p_amount_minor THEN
      RAISE EXCEPTION 'operation_id_conflict';
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO ledger_transactions (
    tenant_id, operation_id, fence_token,
    debit_account_id, credit_account_id, amount_minor
  ) VALUES (
    p_tenant_id, p_operation_id, p_fence_token,
    p_debit_account_id, p_credit_account_id, p_amount_minor
  ) RETURNING id INTO v_transaction_id;

  INSERT INTO ledger_entries (transaction_id, tenant_id, account_id, amount_minor)
  VALUES
    (v_transaction_id, p_tenant_id, p_debit_account_id, -p_amount_minor),
    (v_transaction_id, p_tenant_id, p_credit_account_id, p_amount_minor);

  RETURN v_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION commit_verified_settlement(
  p_tenant_id text,
  p_table_id text,
  p_hand_id text,
  p_epoch bigint,
  p_outcome_digest text,
  p_settlement_digest text,
  p_allocations jsonb,
  p_fence_token bigint
)
RETURNS TABLE(status text, receipt_id bigint, transaction_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt_id bigint;
  v_existing_count integer;
  v_allocation_count integer;
  v_account_count integer;
  v_account_id bigint;
  v_balance numeric;
  v_required numeric;
  v_transaction_id bigint;
  v_transaction_count integer := 0;
  v_debit record;
  v_transfer record;
BEGIN
  -- record_verified_settlement_receipt performs canonical/allocation checks and
  -- acquires a transaction-scoped tenant+hand advisory lock. The lock remains
  -- held for the rest of this function, serializing exact retries and tamper.
  v_receipt_id := record_verified_settlement_receipt(
    p_tenant_id, p_table_id, p_hand_id, p_epoch,
    p_outcome_digest, p_settlement_digest, p_allocations
  );

  SELECT sc.transaction_count INTO v_existing_count
  FROM settlement_commits sc
  WHERE sc.receipt_id = v_receipt_id;

  IF FOUND THEN
    RETURN QUERY SELECT 'replay'::text, v_receipt_id, v_existing_count;
    RETURN;
  END IF;

  PERFORM lock_ledger_fence(p_tenant_id, p_fence_token);

  SELECT jsonb_array_length(p_allocations) INTO v_allocation_count;

  -- Fence lock is acquired first, then every participant account is locked in
  -- deterministic numeric-ID order to avoid check/write races and deadlocks.
  PERFORM a.id
  FROM ledger_accounts a
  JOIN jsonb_array_elements(p_allocations) row_value
    ON a.account_code = row_value->>'accountId'
  WHERE a.tenant_id = p_tenant_id
  ORDER BY a.id
  FOR UPDATE;

  SELECT count(*) INTO v_account_count
  FROM ledger_accounts a
  JOIN jsonb_array_elements(p_allocations) row_value
    ON a.account_code = row_value->>'accountId'
  WHERE a.tenant_id = p_tenant_id;

  IF v_account_count <> v_allocation_count THEN
    RAISE EXCEPTION 'settlement_account_missing';
  END IF;

  -- Custody accounts are never allowed to debit more than their durable net
  -- ledger position. Funding/top-up policy is upstream of this settlement gate.
  FOR v_debit IN
    SELECT row_value->>'accountId' AS account_code,
           -((row_value->>'deltaMinor')::numeric) AS required_minor
    FROM jsonb_array_elements(p_allocations) row_value
    WHERE (row_value->>'deltaMinor')::numeric < 0
    ORDER BY row_value->>'accountId'
  LOOP
    SELECT a.id INTO v_account_id
    FROM ledger_accounts a
    WHERE a.tenant_id = p_tenant_id AND a.account_code = v_debit.account_code;

    SELECT COALESCE(sum(e.amount_minor), 0) INTO v_balance
    FROM ledger_entries e
    WHERE e.tenant_id = p_tenant_id AND e.account_id = v_account_id;

    v_required := v_debit.required_minor;
    IF v_balance < v_required THEN
      RAISE EXCEPTION 'insufficient_custody:%', v_debit.account_code;
    END IF;
  END LOOP;

  -- Deterministic interval-overlap matching converts N-way zero-sum
  -- allocations into a canonical list of pairwise double-entry transfers.
  FOR v_transfer IN
    WITH allocation_rows AS (
      SELECT row_value->>'accountId' AS account_code,
             (row_value->>'deltaMinor')::numeric AS delta_minor
      FROM jsonb_array_elements(p_allocations) row_value
    ),
    debits AS (
      SELECT account_code,
             COALESCE(sum(-delta_minor) OVER (
               ORDER BY account_code ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS start_pos,
             sum(-delta_minor) OVER (ORDER BY account_code ROWS UNBOUNDED PRECEDING) AS end_pos
      FROM allocation_rows
      WHERE delta_minor < 0
    ),
    credits AS (
      SELECT account_code,
             COALESCE(sum(delta_minor) OVER (
               ORDER BY account_code ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS start_pos,
             sum(delta_minor) OVER (ORDER BY account_code ROWS UNBOUNDED PRECEDING) AS end_pos
      FROM allocation_rows
      WHERE delta_minor > 0
    ),
    pairs AS (
      SELECT d.account_code AS debit_code,
             c.account_code AS credit_code,
             LEAST(d.end_pos, c.end_pos) - GREATEST(d.start_pos, c.start_pos) AS amount_minor
      FROM debits d
      CROSS JOIN credits c
      WHERE LEAST(d.end_pos, c.end_pos) > GREATEST(d.start_pos, c.start_pos)
    )
    SELECT debit_code,
           credit_code,
           amount_minor::bigint AS amount_minor,
           row_number() OVER (ORDER BY debit_code, credit_code)::integer AS sequence_no
    FROM pairs
    ORDER BY debit_code, credit_code
  LOOP
    SELECT id INTO v_account_id
    FROM ledger_accounts
    WHERE tenant_id = p_tenant_id AND account_code = v_transfer.debit_code;

    SELECT a.id INTO v_transaction_id
    FROM ledger_accounts a
    WHERE a.tenant_id = p_tenant_id AND a.account_code = v_transfer.credit_code;

    v_transaction_id := apply_ledger_transfer(
      p_tenant_id,
      'settle:' || p_settlement_digest || ':' || v_transfer.sequence_no::text,
      p_fence_token,
      v_account_id,
      v_transaction_id,
      v_transfer.amount_minor
    );

    INSERT INTO settlement_ledger_transactions(receipt_id, sequence_no, transaction_id)
    VALUES (v_receipt_id, v_transfer.sequence_no, v_transaction_id);

    v_transaction_count := v_transaction_count + 1;
  END LOOP;

  INSERT INTO settlement_commits(receipt_id, transaction_count)
  VALUES (v_receipt_id, v_transaction_count);

  RETURN QUERY SELECT 'applied'::text, v_receipt_id, v_transaction_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_verified_settlement_receipt(text, text, text, bigint, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION commit_verified_settlement(text, text, text, bigint, text, text, jsonb, bigint) FROM PUBLIC;

COMMIT;
