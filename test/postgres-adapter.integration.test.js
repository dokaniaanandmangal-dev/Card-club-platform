import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { executeFinancialIntegritySettlement } from '../src/financial/financial-integrity-controller.js';
import { createPostgresSettlementPersistence } from '../src/financial/postgres-settlement-adapter.js';
import { computeShadowSettlement } from '../src/financial/settlement-shadow.js';
import { createAuthoritativeOutcome } from '../src/game/outcome.js';
import { createPostgresOutcomePersistence } from '../src/game/postgres-outcome-adapter.js';

const { Pool } = pg;
const connectionString = process.env.PG_INTEGRATION_URL;

if (!connectionString) {
  test('PostgreSQL adapter integration is CI-gated', { skip: 'PG_INTEGRATION_URL not set' }, () => {});
} else {
  test('Game Core persisted outcome is mandatory before Financial Integrity commit', async t => {
    const fixturePool = new Pool({ connectionString, max: 1 });
    const settlementPersistence = createPostgresSettlementPersistence({ connectionString, maxConnections: 2 });
    const outcomePersistence = createPostgresOutcomePersistence({ connectionString, maxConnections: 2 });
    t.after(async () => {
      await settlementPersistence.close();
      await outcomePersistence.close();
      await fixturePool.end();
    });

    const tenantId = 'club-adapter-e2e';
    const tableId = 'table-adapter-1';
    const handId = 'hand-adapter-0001';
    const clearing = await fixturePool.query('INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ($1,$2) RETURNING id', [tenantId, 'system:clearing']);
    const alice = await fixturePool.query('INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ($1,$2) RETURNING id', [tenantId, 'player:alice']);
    const bob = await fixturePool.query('INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ($1,$2) RETURNING id', [tenantId, 'player:bob']);
    await fixturePool.query('SELECT apply_ledger_transfer($1,$2,$3,$4,$5,$6)', [tenantId, 'adapter-fund-bob-001', '1', clearing.rows[0].id, bob.rows[0].id, '7000']);
    await fixturePool.query('SELECT apply_ledger_transfer($1,$2,$3,$4,$5,$6)', [tenantId, 'adapter-fund-alice01', '1', clearing.rows[0].id, alice.rows[0].id, '3000']);

    const outcome = createAuthoritativeOutcome({
      tenantId, tableId, handId, epoch: 1, sequence: 0, previousOutcomeDigest: null,
      publicState: { phase: 'settled' },
      seats: [
        { seatId: 'seat-1', playerId: 'player:alice', publicState: {}, privateState: { cards: ['AS','AD'] } },
        { seatId: 'seat-2', playerId: 'player:bob', publicState: {}, privateState: { cards: ['KH','KD'] } },
      ],
    });
    const recorded = await outcomePersistence.record(outcome);
    assert.equal(recorded.status, 'recorded');
    assert.equal((await outcomePersistence.record(outcome)).status, 'replay');

    const input = {
      tenantId, tableId, handId, epoch: 1,
      participants: [
        { accountId: 'player:alice', openingMinor: '3000', closingMinor: '5000' },
        { accountId: 'player:bob', openingMinor: '7000', closingMinor: '5000' },
      ],
    };

    const applied = await executeFinancialIntegritySettlement(input, {
      fenceToken: '2', loadOutcome: outcomePersistence.loadForSettlement, commit: settlementPersistence.commit,
    });
    assert.equal(applied.status, 'applied');
    assert.equal(applied.transactionCount, 1);
    const replay = await executeFinancialIntegritySettlement(input, {
      fenceToken: '2', loadOutcome: outcomePersistence.loadForSettlement, commit: settlementPersistence.commit,
    });
    assert.equal(replay.status, 'replay');
    assert.equal(replay.receiptId, applied.receiptId);

    const balances = await fixturePool.query(`
      SELECT a.account_code, COALESCE(sum(e.amount_minor),0)::text AS balance
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.tenant_id=a.tenant_id AND e.account_id=a.id
      WHERE a.tenant_id=$1 AND a.account_code IN ('player:alice','player:bob')
      GROUP BY a.account_code ORDER BY a.account_code
    `, [tenantId]);
    assert.deepEqual(balances.rows, [
      { account_code: 'player:alice', balance: '5000' },
      { account_code: 'player:bob', balance: '5000' },
    ]);

    const beforeCount = await fixturePool.query('SELECT count(*)::int AS count FROM settlement_commits sc JOIN settlement_receipts sr ON sr.id=sc.receipt_id WHERE sr.tenant_id=$1', [tenantId]);
    const maliciousShadow = value => {
      const result = computeShadowSettlement(value);
      return { ...result, outcomeDigest: 'f'.repeat(64) };
    };
    await assert.rejects(executeFinancialIntegritySettlement({ ...input, handId }, {
      fenceToken: '2', loadOutcome: outcomePersistence.loadForSettlement,
      shadow: maliciousShadow, commit: settlementPersistence.commit,
    }), /shadow_mismatch/);

    await assert.rejects(executeFinancialIntegritySettlement({ ...input, handId: 'hand-not-persisted' }, {
      fenceToken: '2', loadOutcome: outcomePersistence.loadForSettlement, commit: settlementPersistence.commit,
    }), /outcome_not_persisted/);
    const afterCount = await fixturePool.query('SELECT count(*)::int AS count FROM settlement_commits sc JOIN settlement_receipts sr ON sr.id=sc.receipt_id WHERE sr.tenant_id=$1', [tenantId]);
    assert.equal(afterCount.rows[0].count, beforeCount.rows[0].count);
  });
}
