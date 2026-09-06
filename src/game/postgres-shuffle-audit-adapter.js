import pg from 'pg';

const { Pool } = pg;

const RECORD_MANIFEST_SQL = `
  SELECT status, manifest_id
  FROM record_shuffle_manifest(
    $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::jsonb,$8::text,$9::smallint
  )
`;

const RECORD_EVENT_SQL = `
  SELECT status, event_id, sequence
  FROM record_shuffle_audit_event($1::text,$2::text,$3::text,$4::text,$5::text)
`;

const LOAD_SQL = `
  SELECT
    m.tenant_id, m.table_id, m.hand_id, m.game_id, m.manifest_digest,
    m.server_commitment, m.participants, m.canonical_deck_digest, m.deck_size,
    e.sequence, e.event_type, e.deck_digest, e.detail_digest, e.reason_code
  FROM shuffle_manifests m
  LEFT JOIN shuffle_audit_events e ON e.manifest_id = m.id
  WHERE m.manifest_digest = $1
  ORDER BY e.sequence NULLS LAST
`;

function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`shuffle_audit_adapter:invalid_${label}`);
  return value;
}

function assertContext(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`shuffle_audit_adapter:invalid_${label}`);
  }
  return value;
}

function assertParticipants(participants) {
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 32) {
    throw new Error('shuffle_audit_adapter:invalid_participants');
  }
  return participants.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('shuffle_audit_adapter:invalid_participant');
    return {
      id: assertContext(entry.id, 'participant_id'),
      commitment: assertDigest(entry.commitment, 'participant_commitment'),
    };
  });
}

function normalizeManifest(input = {}) {
  const deckSize = Number(input.deckSize);
  if (!Number.isSafeInteger(deckSize) || deckSize < 2 || deckSize > 512) throw new Error('shuffle_audit_adapter:invalid_deck_size');
  return Object.freeze({
    tenantId: assertContext(input.tenantId, 'tenant_id'),
    tableId: assertContext(input.tableId, 'table_id'),
    handId: assertContext(input.handId, 'hand_id'),
    gameId: assertContext(input.gameId, 'game_id'),
    manifestDigest: assertDigest(input.manifestDigest, 'manifest_digest'),
    serverCommitment: assertDigest(input.serverCommitment, 'server_commitment'),
    participants: assertParticipants(input.participants),
    canonicalDeckDigest: assertDigest(input.canonicalDeckDigest, 'canonical_deck_digest'),
    deckSize,
  });
}

function normalizeEventBase(input = {}) {
  return Object.freeze({
    tenantId: assertContext(input.tenantId, 'tenant_id'),
    tableId: assertContext(input.tableId, 'table_id'),
    handId: assertContext(input.handId, 'hand_id'),
    gameId: assertContext(input.gameId, 'game_id'),
    manifestDigest: assertDigest(input.manifestDigest, 'manifest_digest'),
  });
}

export function createPostgresShuffleAuditPersistence({
  connectionString,
  ssl,
  maxConnections = 4,
  applicationName = 'card-club-shuffle-audit',
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString.startsWith('postgres')) {
    throw new Error('shuffle_audit_adapter:connection_string_required');
  }
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 32) {
    throw new Error('shuffle_audit_adapter:invalid_pool_size');
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

  const inSerializableTransaction = async callback => {
    const client = await pool.connect();
    let open = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      open = true;
      const value = await callback(client);
      await client.query('COMMIT');
      open = false;
      return value;
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      }
      throw error;
    } finally {
      client.release();
    }
  };

  const recordManifest = async input => {
    const value = normalizeManifest(input);
    return inSerializableTransaction(async client => {
      const result = await client.query({
        text: RECORD_MANIFEST_SQL,
        values: [
          value.tenantId,
          value.tableId,
          value.handId,
          value.gameId,
          value.manifestDigest,
          value.serverCommitment,
          JSON.stringify(value.participants),
          value.canonicalDeckDigest,
          String(value.deckSize),
        ],
      });
      if (result.rows.length !== 1) throw new Error('shuffle_audit_adapter:unexpected_manifest_result');
      const row = result.rows[0];
      if (row.status !== 'recorded' && row.status !== 'replay') throw new Error('shuffle_audit_adapter:unexpected_manifest_status');
      return Object.freeze({ status: row.status, manifestId: String(row.manifest_id) });
    });
  };

  const recordEvent = async ({ manifestDigest, eventType, deckDigest = null, detailDigest = null, reasonCode = null }) => {
    assertDigest(manifestDigest, 'manifest_digest');
    if (!['deck_issued', 'aborted', 'disclosed'].includes(eventType)) throw new Error('shuffle_audit_adapter:invalid_event_type');
    if (deckDigest !== null) assertDigest(deckDigest, 'deck_digest');
    if (detailDigest !== null) assertDigest(detailDigest, 'detail_digest');
    if (reasonCode !== null && (typeof reasonCode !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(reasonCode))) {
      throw new Error('shuffle_audit_adapter:invalid_reason_code');
    }
    return inSerializableTransaction(async client => {
      const result = await client.query({
        text: RECORD_EVENT_SQL,
        values: [manifestDigest, eventType, deckDigest, detailDigest, reasonCode],
      });
      if (result.rows.length !== 1) throw new Error('shuffle_audit_adapter:unexpected_event_result');
      const row = result.rows[0];
      return Object.freeze({
        status: row.status,
        eventId: String(row.event_id),
        sequence: Number(row.sequence),
      });
    });
  };

  const recordDeckIssued = async input => {
    const base = normalizeEventBase(input);
    const result = await recordEvent({ manifestDigest: base.manifestDigest, eventType: 'deck_issued', deckDigest: assertDigest(input.deckDigest, 'deck_digest') });
    if (result.status !== 'issued' && result.status !== 'replay') throw new Error('shuffle_audit_adapter:unexpected_issue_status');
    return result;
  };

  const recordAbort = async input => {
    const base = normalizeEventBase(input);
    if (typeof input.reasonCode !== 'string') throw new Error('shuffle_audit_adapter:reason_required');
    const result = await recordEvent({ manifestDigest: base.manifestDigest, eventType: 'aborted', reasonCode: input.reasonCode });
    if (result.status !== 'aborted' && result.status !== 'replay') throw new Error('shuffle_audit_adapter:unexpected_abort_status');
    return result;
  };

  const recordDisclosure = async input => {
    const base = normalizeEventBase(input);
    const result = await recordEvent({
      manifestDigest: base.manifestDigest,
      eventType: 'disclosed',
      deckDigest: assertDigest(input.deckDigest, 'deck_digest'),
      detailDigest: assertDigest(input.disclosureDigest, 'detail_digest'),
    });
    if (result.status !== 'disclosed' && result.status !== 'replay') throw new Error('shuffle_audit_adapter:unexpected_disclosure_status');
    return result;
  };

  const loadAudit = async manifestDigest => {
    assertDigest(manifestDigest, 'manifest_digest');
    const result = await pool.query({ text: LOAD_SQL, values: [manifestDigest] });
    if (result.rows.length < 1) throw new Error('shuffle_audit_adapter:not_found');
    const first = result.rows[0];
    return Object.freeze({
      tenantId: first.tenant_id,
      tableId: first.table_id,
      handId: first.hand_id,
      gameId: first.game_id,
      manifestDigest: first.manifest_digest,
      serverCommitment: first.server_commitment,
      participants: first.participants,
      canonicalDeckDigest: first.canonical_deck_digest,
      deckSize: Number(first.deck_size),
      events: Object.freeze(result.rows.filter(row => row.event_type).map(row => Object.freeze({
        sequence: Number(row.sequence),
        eventType: row.event_type,
        deckDigest: row.deck_digest,
        detailDigest: row.detail_digest,
        reasonCode: row.reason_code,
      }))),
    });
  };

  return Object.freeze({
    recordManifest,
    recordDeckIssued,
    recordAbort,
    recordDisclosure,
    loadAudit,
    close: () => pool.end(),
  });
}
