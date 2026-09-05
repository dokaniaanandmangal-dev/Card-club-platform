BEGIN;

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  account_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS ledger_fence (
  tenant_id text PRIMARY KEY,
  max_token bigint NOT NULL CHECK (max_token >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  operation_id text NOT NULL,
  fence_token bigint NOT NULL CHECK (fence_token >= 0),
  debit_account_id bigint NOT NULL,
  credit_account_id bigint NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (debit_account_id <> credit_account_id),
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, debit_account_id)
    REFERENCES ledger_accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, credit_account_id)
    REFERENCES ledger_accounts (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id bigint NOT NULL REFERENCES ledger_transactions (id),
  tenant_id text NOT NULL,
  account_id bigint NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, account_id)
    REFERENCES ledger_accounts (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx
  ON ledger_entries (transaction_id);

CREATE OR REPLACE FUNCTION deny_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append_only_ledger';
END;
$$;

DROP TRIGGER IF EXISTS ledger_transactions_append_only ON ledger_transactions;
CREATE TRIGGER ledger_transactions_append_only
BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();

DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();

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
  v_current_fence bigint;
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

  -- Re-check under the tenant fence lock so concurrent retries converge.
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
    tenant_id,
    operation_id,
    fence_token,
    debit_account_id,
    credit_account_id,
    amount_minor
  ) VALUES (
    p_tenant_id,
    p_operation_id,
    p_fence_token,
    p_debit_account_id,
    p_credit_account_id,
    p_amount_minor
  ) RETURNING id INTO v_transaction_id;

  INSERT INTO ledger_entries (transaction_id, tenant_id, account_id, amount_minor)
  VALUES
    (v_transaction_id, p_tenant_id, p_debit_account_id, -p_amount_minor),
    (v_transaction_id, p_tenant_id, p_credit_account_id, p_amount_minor);

  RETURN v_transaction_id;
END;
$$;

COMMIT;
