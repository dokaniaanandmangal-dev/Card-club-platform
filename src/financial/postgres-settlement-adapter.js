import pg from 'pg';

const { Pool } = pg;
const SHA256_RE = /^[0-9a-f]{64}$/;
const FENCE_RE = /^[1-9][0-9]{0,18}$/;
const COMMIT_SQL = `
  SELECT status, receipt_id, transaction_count
  FROM commit_verified_settlement(
    $1::text, $2::text, $3::text, $4::bigint,
    $5::text, $6::text, $7::jsonb, $8::bigint
  )
`;

function validateCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('postgres_adapter:invalid_command');
  }
  if (command.verificationScheme !== 'dual-v1') throw new Error('postgres_adapter:unverified_settlement');
  if (!SHA256_RE.test(command.outcomeDigest ?? '')) throw new Error('postgres_adapter:invalid_outcome_digest');
  if (!SHA256_RE.test(command.settlementDigest ?? '')) throw new Error('postgres_adapter:invalid_settlement_digest');
  if (!FENCE_RE.test(command.fenceToken ?? '')) throw new Error('postgres_adapter:invalid_fence_token');
  if (!Array.isArray(command.allocations) || command.allocations.length < 2 || command.allocations.length > 64) {
    throw new Error('postgres_adapter:invalid_allocations');
  }
}

export function createPostgresSettlementPersistence({
  connectionString,
  ssl,
  maxConnections = 4,
  applicationName = 'card-club-financial-integrity',
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString.startsWith('postgres')) {
    throw new Error('postgres_adapter:connection_string_required');
  }
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 32) {
    throw new Error('postgres_adapter:invalid_pool_size');
  }

  const pool = new Pool({
    connectionString,
    ssl,
    max: maxConnections,
    application_name: applicationName,
    statement_timeout: 10_000,
    query_timeout: 12_000,
    idle_in_transaction_session_timeout: 10_000,
  });

  const commit = async command => {
    validateCommand(command);
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      transactionOpen = true;
      const result = await client.query({
        text: COMMIT_SQL,
        values: [
          command.tenantId,
          command.tableId,
          command.handId,
          String(command.epoch),
          command.outcomeDigest,
          command.settlementDigest,
          JSON.stringify(command.allocations),
          command.fenceToken,
        ],
      });

      if (result.rows.length !== 1) throw new Error('postgres_adapter:unexpected_commit_result');
      const row = result.rows[0];
      if (row.status !== 'applied' && row.status !== 'replay') {
        throw new Error('postgres_adapter:unexpected_commit_status');
      }

      await client.query('COMMIT');
      transactionOpen = false;
      return Object.freeze({
        status: row.status,
        receiptId: String(row.receipt_id),
        transactionCount: Number(row.transaction_count),
      });
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      }
      throw error;
    } finally {
      client.release();
    }
  };

  return Object.freeze({
    commit,
    close: () => pool.end(),
  });
}
