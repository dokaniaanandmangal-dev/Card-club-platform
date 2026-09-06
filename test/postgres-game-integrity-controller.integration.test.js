import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

import { createPostgresSettlementPersistence } from '../src/financial/postgres-settlement-adapter.js';
import { commitShuffleSeed } from '../src/game/fair-shuffle.js';
import { finalizeGameIntegrityHand, routeGameIntegrityDeck } from '../src/game/game-integrity-controller.js';
import { createPostgresOutcomePersistence } from '../src/game/postgres-outcome-adapter.js';
import { createPostgresShuffleAuditPersistence } from '../src/game/postgres-shuffle-audit-adapter.js';
import { beginAuditedShuffle, issueAuditedDeck } from '../src/game/shuffle-orchestrator.js';
import { buildTeenPattiDeck } from '../src/game/teen-patti/cards.js';

const { Pool } = pg;
const connectionString = process.env.PG_INTEGRATION_URL;

function seedFixture(context) {
  const serverSeed = '71'.repeat(32);
  const aliceSeed = '82'.repeat(32);
  const bobSeed = '93'.repeat(32);
  return {
    serverSeed,
    participantSeeds: [
      { id: 'alice', seed: aliceSeed },
      { id: 'bob', seed: bobSeed },
    ],
    serverCommitment: commitShuffleSeed({ context, role: 'server', actorId: 'server', seed: serverSeed }),
    participants: [
      { id: 'alice', commitment: commitShuffleSeed({ context, role: 'participant', actorId: 'alice', seed: aliceSeed }) },
      { id: 'bob', commitment: commitShuffleSeed({ context, role: 'participant', actorId: 'bob', seed: bobSeed }) },
    ],
  };
}

if (!connectionString) {
  test('Game Integrity Controller PostgreSQL integration is CI-gated', { skip: 'PG_INTEGRATION_URL not set' }, () => {});
} else {
  test('audited shuffle -> persisted bound outcome -> dual verified atomic ledger settlement', async t => {
    const fixturePool = new Pool({ connectionString, max: 1 });
    const shufflePersistence = createPostgresShuffleAuditPersistence({ connectionString, maxConnections: 2 });
    const outcomePersistence = createPostgresOutcomePersistence({ connectionString, maxConnections: 2 });
    const settlementPersistence = createPostgresSettlementPersistence({ connectionString, maxConnections: 2 });
    t.after(async () => {
      await shufflePersistence.close();
      await outcomePersistence.close();
      await settlementPersistence.close();
      await fixturePool.end();
    });

    const context = {
      tenantId: 'club-gic-e2e',
      tableId: 'table-gic-1',
      handId: 'hand-gic-0001',
      gameId: 'teen_patti_classic',
    };

    const clearing = await fixturePool.query('INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ($1,$2) RETURNING id', [context.tenantId, 'system:clearing']);
    const alice = await fixturePool.query('INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ($1,$2) RETURNING id', [context.tenantId, 'player:alice']);
    const bob = await fixturePool.query('INSERT INTO ledger_accounts(tenant_id, account_code) VALUES ($1,$2) RETURNING id', [context.tenantId, 'player:bob']);
    await fixturePool.query('SELECT apply_ledger_transfer($1,$2,$3,$4,$5,$6)', [context.tenantId, 'gic-fund-bob-001', '1', clearing.rows[0].id, bob.rows[0].id, '7000']);
    await fixturePool.query('SELECT apply_ledger_transfer($1,$2,$3,$4,$5,$6)', [context.tenantId, 'gic-fund-alice01', '1', clearing.rows[0].id, alice.rows[0].id, '3000']);

    const seeds = seedFixture(context);
    const shuffleSession = await beginAuditedShuffle({
      canonicalDeck: buildTeenPattiDeck(),
      context,
      serverCommitment: seeds.serverCommitment,
      participants: seeds.participants,
      persistence: shufflePersistence,
    });
    const issued = await issueAuditedDeck(shuffleSession, {
      serverSeed: seeds.serverSeed,
      participantSeeds: seeds.participantSeeds,
    });
    const routed = routeGameIntegrityDeck(issued, deck => ({ cardCount: deck.length, firstCardId: deck[0].id }));
    assert.equal(routed.consumerResult.cardCount, 52);

    const outcome = {
      tenantId: context.tenantId,
      tableId: context.tableId,
      handId: context.handId,
      epoch: 1,
      sequence: 0,
      previousOutcomeDigest: null,
      publicState: { phase: 'settled', winnerId: 'player:alice' },
      seats: [
        { seatId: 'seat-1', playerId: 'player:alice', publicState: { status: 'winner' }, privateState: { cards: ['AS', 'AD', 'AC'] } },
        { seatId: 'seat-2', playerId: 'player:bob', publicState: { status: 'loser' }, privateState: { cards: ['KH', 'KD', 'KC'] } },
      ],
    };
    const settlement = {
      participants: [
        { accountId: 'player:alice', openingMinor: '3000', closingMinor: '5000' },
        { accountId: 'player:bob', openingMinor: '7000', closingMinor: '5000' },
      ],
    };

    const applied = await finalizeGameIntegrityHand({ handToken: routed.handToken, outcome, settlement }, {
      outcomePersistence,
      fenceToken: '11',
      commit: settlementPersistence.commit,
    });
    assert.equal(applied.status, 'settled');
    assert.equal(applied.outcomePersistenceStatus, 'recorded');
    assert.equal(applied.financialReceipt.status, 'applied');
    assert.equal(applied.financialReceipt.transactionCount, 1);
    assert.equal(applied.shuffleManifestDigest, issued.auditReceipt.manifestDigest);
    assert.equal(applied.shuffledDeckDigest, issued.auditReceipt.deckDigest);
    assert.match(applied.settlementIntentDigest, /^[0-9a-f]{64}$/);

    const audit = await shufflePersistence.loadAudit(issued.auditReceipt.manifestDigest);
    assert.equal(audit.tenantId, context.tenantId);
    assert.equal(audit.tableId, context.tableId);
    assert.equal(audit.handId, context.handId);
    assert.equal(audit.events[0].eventType, 'deck_issued');
    assert.equal(audit.events[0].deckDigest, applied.shuffledDeckDigest);

    const persistedOutcome = await outcomePersistence.loadForSettlement({
      tenantId: context.tenantId,
      tableId: context.tableId,
      handId: context.handId,
      epoch: 1,
    });
    assert.equal(persistedOutcome.outcomeDigest, applied.outcomeDigest);

    const balances = await fixturePool.query(`
      SELECT a.account_code, COALESCE(sum(e.amount_minor),0)::text AS balance
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.tenant_id=a.tenant_id AND e.account_id=a.id
      WHERE a.tenant_id=$1 AND a.account_code IN ('player:alice','player:bob')
      GROUP BY a.account_code ORDER BY a.account_code
    `, [context.tenantId]);
    assert.deepEqual(balances.rows, [
      { account_code: 'player:alice', balance: '5000' },
      { account_code: 'player:bob', balance: '5000' },
    ]);

    const replay = await finalizeGameIntegrityHand({ handToken: routed.handToken, outcome, settlement }, {
      outcomePersistence,
      fenceToken: '11',
      commit: settlementPersistence.commit,
    });
    assert.equal(replay.outcomePersistenceStatus, 'replay');
    assert.equal(replay.financialReceipt.status, 'replay');
    assert.equal(replay.outcomeDigest, applied.outcomeDigest);
    assert.equal(replay.financialReceipt.receiptId, applied.financialReceipt.receiptId);

    const changedSettlement = {
      participants: [
        { accountId: 'player:alice', openingMinor: '3000', closingMinor: '4500' },
        { accountId: 'player:bob', openingMinor: '7000', closingMinor: '5500' },
      ],
    };
    await assert.rejects(
      finalizeGameIntegrityHand({ handToken: routed.handToken, outcome, settlement: changedSettlement }, {
        outcomePersistence,
        fenceToken: '11',
        commit: settlementPersistence.commit,
      }),
    );

    const finalBalances = await fixturePool.query(`
      SELECT a.account_code, COALESCE(sum(e.amount_minor),0)::text AS balance
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.tenant_id=a.tenant_id AND e.account_id=a.id
      WHERE a.tenant_id=$1 AND a.account_code IN ('player:alice','player:bob')
      GROUP BY a.account_code ORDER BY a.account_code
    `, [context.tenantId]);
    assert.deepEqual(finalBalances.rows, balances.rows);
  });
}
