import test from 'node:test';
import assert from 'node:assert/strict';

import { computeShadowSettlement } from '../src/financial/settlement-shadow.js';
import { commitShuffleSeed } from '../src/game/fair-shuffle.js';
import {
  finalizeGameIntegrityHand,
  routeGameIntegrityDeck,
} from '../src/game/game-integrity-controller.js';
import { buildTeenPattiDeck } from '../src/game/teen-patti/cards.js';
import {
  beginAuditedShuffle,
  issueAuditedDeck,
  isRoutedAuditedDeck,
  routeAuditedDeck,
} from '../src/game/shuffle-orchestrator.js';

function seedFixture(context) {
  const serverSeed = '11'.repeat(32);
  const aliceSeed = '22'.repeat(32);
  const bobSeed = '33'.repeat(32);
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

function memoryShufflePersistence() {
  return {
    async recordManifest() { return { status: 'recorded' }; },
    async recordDeckIssued() { return { status: 'issued' }; },
    async recordAbort() { return { status: 'aborted' }; },
    async recordDisclosure() { return { status: 'disclosed' }; },
  };
}

function memoryOutcomePersistence() {
  let stored = null;
  return {
    async record(outcome) {
      if (stored === null) {
        stored = outcome;
        return { status: 'recorded', outcomeDigest: outcome.outcomeDigest };
      }
      if (stored.outcomeDigest !== outcome.outcomeDigest) throw new Error('memory_outcome:changed_replay');
      return { status: 'replay', outcomeDigest: outcome.outcomeDigest };
    },
    async loadForSettlement(scope) {
      if (
        stored === null
        || stored.tenantId !== scope.tenantId
        || stored.tableId !== scope.tableId
        || stored.handId !== scope.handId
        || stored.epoch !== scope.epoch
      ) throw new Error('financial_integrity:outcome_not_persisted');
      return {
        tenantId: stored.tenantId,
        tableId: stored.tableId,
        handId: stored.handId,
        epoch: stored.epoch,
        outcomeDigest: stored.outcomeDigest,
      };
    },
    get stored() { return stored; },
  };
}

async function issuedFixture(suffix = '001') {
  const context = {
    tenantId: 'tenant-gic',
    tableId: `table-${suffix}`,
    handId: `hand-${suffix}`,
    gameId: 'teen_patti_classic',
  };
  const seeds = seedFixture(context);
  const session = await beginAuditedShuffle({
    canonicalDeck: buildTeenPattiDeck(),
    context,
    serverCommitment: seeds.serverCommitment,
    participants: seeds.participants,
    persistence: memoryShufflePersistence(),
  });
  const issued = await issueAuditedDeck(session, {
    serverSeed: seeds.serverSeed,
    participantSeeds: seeds.participantSeeds,
  });
  return { context, issued };
}

function outcomeFor(context) {
  return {
    tenantId: context.tenantId,
    tableId: context.tableId,
    handId: context.handId,
    epoch: 1,
    sequence: 0,
    previousOutcomeDigest: null,
    publicState: { phase: 'settled', winnerId: 'alice' },
    seats: [
      { seatId: 'seat-1', playerId: 'alice', publicState: { status: 'winner' }, privateState: { cards: ['AS', 'AD', 'AC'] } },
      { seatId: 'seat-2', playerId: 'bob', publicState: { status: 'loser' }, privateState: { cards: ['KH', 'KD', 'KC'] } },
    ],
  };
}

const settlement = Object.freeze({
  participants: Object.freeze([
    Object.freeze({ accountId: 'alice', openingMinor: '5000', closingMinor: '6000' }),
    Object.freeze({ accountId: 'bob', openingMinor: '5000', closingMinor: '4000' }),
  ]),
});

test('routed audited deck -> shuffle/settlement-bound outcome -> dual-verified commit', async () => {
  const { context, issued } = await issuedFixture('happy');
  const routed = routeGameIntegrityDeck(issued, (deck, auditReceipt) => ({
    cardCount: deck.length,
    deckDigest: auditReceipt.deckDigest,
  }));
  assert.equal(routed.consumerResult.cardCount, 52);
  assert.equal(isRoutedAuditedDeck(issued), true);

  const outcomes = memoryOutcomePersistence();
  let committed = null;
  const result = await finalizeGameIntegrityHand({
    handToken: routed.handToken,
    outcome: outcomeFor(context),
    settlement,
  }, {
    outcomePersistence: outcomes,
    fenceToken: '7',
    commit: async command => {
      committed = command;
      return { status: 'applied', receiptId: 'receipt-1', transactionCount: 1 };
    },
  });

  assert.equal(result.status, 'settled');
  assert.equal(result.gameId, context.gameId);
  assert.equal(result.outcomeDigest, outcomes.stored.outcomeDigest);
  assert.equal(committed.outcomeDigest, result.outcomeDigest);
  assert.equal(committed.verificationScheme, 'dual-v1');
  assert.equal(committed.fenceToken, '7');
  assert.deepEqual(committed.allocations, [
    { accountId: 'alice', deltaMinor: '1000' },
    { accountId: 'bob', deltaMinor: '-1000' },
  ]);

  const integrity = outcomes.stored.publicState.gameIntegrity;
  assert.equal(integrity.scheme, 'game-integrity-v1');
  assert.equal(integrity.gameId, context.gameId);
  assert.equal(integrity.shuffleManifestDigest, issued.auditReceipt.manifestDigest);
  assert.equal(integrity.shuffledDeckDigest, issued.auditReceipt.deckDigest);
  assert.equal(integrity.canonicalDeckDigest, issued.auditReceipt.canonicalDeckDigest);
  assert.equal(integrity.settlementIntentDigest, result.settlementIntentDigest);
  assert.match(integrity.settlementIntentDigest, /^[0-9a-f]{64}$/);
});

test('audited deck routing is single-use and consumer failure burns the deck', async () => {
  const first = await issuedFixture('single');
  routeGameIntegrityDeck(first.issued, deck => deck.length);
  assert.throws(() => routeAuditedDeck(first.issued, deck => deck.length), /deck_already_routed/);
  assert.throws(() => routeGameIntegrityDeck(first.issued, deck => deck.length), /deck_already_routed/);

  const failed = await issuedFixture('burn');
  assert.throws(() => routeGameIntegrityDeck(failed.issued, () => { throw new Error('game_boot_failed'); }), /game_boot_failed/);
  assert.equal(isRoutedAuditedDeck(failed.issued), true);
  assert.throws(() => routeAuditedDeck(failed.issued, deck => deck.length), /deck_already_routed/);
});

test('forged tokens, shuffle/outcome scope mismatch and caller integrity overrides fail before persistence', async () => {
  const { context, issued } = await issuedFixture('boundary');
  const routed = routeGameIntegrityDeck(issued, deck => deck.length);
  const outcomes = memoryOutcomePersistence();
  let commits = 0;
  const deps = { outcomePersistence: outcomes, fenceToken: '3', commit: async () => { commits += 1; return { status: 'applied' }; } };

  await assert.rejects(finalizeGameIntegrityHand({ handToken: {}, outcome: outcomeFor(context), settlement }, deps), /invalid_hand_token/);

  const wrongScope = { ...outcomeFor(context), tableId: 'different-table' };
  await assert.rejects(finalizeGameIntegrityHand({ handToken: routed.handToken, outcome: wrongScope, settlement }, deps), /shuffle_outcome_scope_mismatch/);

  const callerDigest = { ...outcomeFor(context), outcomeDigest: 'f'.repeat(64) };
  await assert.rejects(finalizeGameIntegrityHand({ handToken: routed.handToken, outcome: callerDigest, settlement }, deps), /caller_outcome_digest_forbidden/);

  const reserved = outcomeFor(context);
  reserved.publicState.gameIntegrity = { forged: true };
  await assert.rejects(finalizeGameIntegrityHand({ handToken: routed.handToken, outcome: reserved, settlement }, deps), /reserved_public_integrity_key/);

  await assert.rejects(finalizeGameIntegrityHand({
    handToken: routed.handToken,
    outcome: outcomeFor(context),
    settlement: { ...settlement, tenantId: context.tenantId },
  }, deps), /settlement_tenantId_forbidden/);

  assert.equal(outcomes.stored, null);
  assert.equal(commits, 0);
});

test('settlement players must exactly match outcome players and exact settlement intent is replay-bound', async () => {
  const { context, issued } = await issuedFixture('intent');
  const routed = routeGameIntegrityDeck(issued, deck => deck.length);
  const outcomes = memoryOutcomePersistence();
  let commits = 0;
  const deps = {
    outcomePersistence: outcomes,
    fenceToken: '9',
    commit: async () => { commits += 1; return { status: commits === 1 ? 'applied' : 'replay', receiptId: 'r1', transactionCount: 1 }; },
  };

  const wrongPlayers = {
    participants: [
      { accountId: 'alice', openingMinor: '5000', closingMinor: '6000' },
      { accountId: 'mallory', openingMinor: '5000', closingMinor: '4000' },
    ],
  };
  await assert.rejects(finalizeGameIntegrityHand({ handToken: routed.handToken, outcome: outcomeFor(context), settlement: wrongPlayers }, deps), /settlement_players_mismatch/);
  assert.equal(outcomes.stored, null);

  const first = await finalizeGameIntegrityHand({ handToken: routed.handToken, outcome: outcomeFor(context), settlement }, deps);
  assert.equal(first.outcomePersistenceStatus, 'recorded');
  assert.equal(commits, 1);

  const exactRetry = await finalizeGameIntegrityHand({ handToken: routed.handToken, outcome: outcomeFor(context), settlement }, deps);
  assert.equal(exactRetry.outcomePersistenceStatus, 'replay');
  assert.equal(exactRetry.outcomeDigest, first.outcomeDigest);
  assert.equal(commits, 2);

  const changedIntent = {
    participants: [
      { accountId: 'alice', openingMinor: '5000', closingMinor: '5500' },
      { accountId: 'bob', openingMinor: '5000', closingMinor: '4500' },
    ],
  };
  await assert.rejects(finalizeGameIntegrityHand({ handToken: routed.handToken, outcome: outcomeFor(context), settlement: changedIntent }, deps), /changed_replay/);
  assert.equal(commits, 2);
});

test('outcome persistence and dual verification failures leave financial commit unreachable', async () => {
  const first = await issuedFixture('persist-fail');
  const firstRouted = routeGameIntegrityDeck(first.issued, deck => deck.length);
  let commits = 0;
  await assert.rejects(finalizeGameIntegrityHand({ handToken: firstRouted.handToken, outcome: outcomeFor(first.context), settlement }, {
    outcomePersistence: {
      record: async () => { throw new Error('database_down'); },
      loadForSettlement: async () => { throw new Error('should_not_load'); },
    },
    fenceToken: '2',
    commit: async () => { commits += 1; },
  }), /database_down/);
  assert.equal(commits, 0);

  const second = await issuedFixture('shadow-fail');
  const secondRouted = routeGameIntegrityDeck(second.issued, deck => deck.length);
  const outcomes = memoryOutcomePersistence();
  const maliciousShadow = input => ({ ...computeShadowSettlement(input), outcomeDigest: 'f'.repeat(64) });
  await assert.rejects(finalizeGameIntegrityHand({ handToken: secondRouted.handToken, outcome: outcomeFor(second.context), settlement }, {
    outcomePersistence: outcomes,
    fenceToken: '2',
    shadow: maliciousShadow,
    commit: async () => { commits += 1; },
  }), /shadow_mismatch/);
  assert.notEqual(outcomes.stored, null);
  assert.equal(commits, 0);
});
