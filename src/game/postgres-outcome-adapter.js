import pg from 'pg';
import { createAuthoritativeOutcome } from './outcome.js';

const { Pool } = pg;
const RECORD_SQL = `
  SELECT status, outcome_id
  FROM record_game_outcome($1::text,$2::text,$3::text,$4::bigint,$5::bigint,$6::text,$7::text)
`;
const LOAD_SQL = `
  SELECT tenant_id, table_id, hand_id, epoch, sequence, previous_outcome_digest, outcome_digest
  FROM game_outcomes
  WHERE tenant_id=$1 AND table_id=$2 AND hand_id=$3 AND epoch=$4::bigint
`;

function verifyAuthoritativeOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) throw new Error('game_outcome_adapter:invalid_outcome');
  const rebuilt = createAuthoritativeOutcome(outcome);
  if (rebuilt.outcomeDigest !== outcome.outcomeDigest) throw new Error('game_outcome_adapter:digest_mismatch');
  return rebuilt;
}

export function createPostgresOutcomePersistence({
  connectionString,
  ssl,
  maxConnections = 4,
  applicationName = 'card-club-game-outcome',
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString.startsWith('postgres')) {
    throw new Error('game_outcome_adapter:connection_string_required');
  }
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 32) {
    throw new Error('game_outcome_adapter:invalid_pool_size');
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

  const record = async outcome => {
    const verified = verifyAuthoritativeOutcome(outcome);
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      transactionOpen = true;
      const result = await client.query({
        text: RECORD_SQL,
        values: [
          verified.tenantId,
          verified.tableId,
          verified.handId,
          String(verified.epoch),
          String(verified.sequence),
          verified.previousOutcomeDigest,
          verified.outcomeDigest,
        ],
      });
      if (result.rows.length !== 1) throw new Error('game_outcome_adapter:unexpected_record_result');
      const row = result.rows[0];
      if (row.status !== 'recorded' && row.status !== 'replay') throw new Error('game_outcome_adapter:unexpected_record_status');
      await client.query('COMMIT');
      transactionOpen = false;
      return Object.freeze({ status: row.status, outcomeId: String(row.outcome_id), outcomeDigest: verified.outcomeDigest });
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      }
      throw error;
    } finally {
      client.release();
    }
  };

  const loadForSettlement = async ({ tenantId, tableId, handId, epoch } = {}) => {
    const result = await pool.query({ text: LOAD_SQL, values: [tenantId, tableId, handId, String(epoch)] });
    if (result.rows.length !== 1) throw new Error('financial_integrity:outcome_not_persisted');
    const row = result.rows[0];
    return Object.freeze({
      tenantId: row.tenant_id,
      tableId: row.table_id,
      handId: row.hand_id,
      epoch: Number(row.epoch),
      sequence: Number(row.sequence),
      previousOutcomeDigest: row.previous_outcome_digest,
      outcomeDigest: row.outcome_digest,
    });
  };

  return Object.freeze({ record, loadForSettlement, close: () => pool.end() });
}
