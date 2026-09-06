import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeenPattiDeck } from '../src/game/teen-patti/cards.js';
import { buildShuffleManifest, commitShuffleSeed } from '../src/game/fair-shuffle.js';
import {
  abortAuditedShuffle,
  beginAuditedShuffle,
  isAuditedDeck,
  issueAuditedDeck,
  recordShuffleDisclosure,
  routeAuditedDeck,
} from '../src/game/shuffle-orchestrator.js';

const serverSeed = '11'.repeat(32);
const aliceSeed = '22'.repeat(32);
const bobSeed = '33'.repeat(32);

function commitments(context) {
  const serverCommitment = commitShuffleSeed({ context, role: 'server', actorId: 'server', seed: serverSeed });
  const participants = [
    { id: 'alice', commitment: commitShuffleSeed({ context, role: 'participant', actorId: 'alice', seed: aliceSeed }) },
    { id: 'bob', commitment: commitShuffleSeed({ context, role: 'participant', actorId: 'bob', seed: bobSeed }) },
  ];
  return { serverCommitment, participants };
}

function createMemoryPersistence() {
  const manifests = new Map();
  const log = [];

  function manifestFor(digest) {
    const entry = manifests.get(digest);
    if (!entry) throw new Error('memory:manifest_not_persisted');
    return entry;
  }

  return {
    log,
    manifests,
    async recordManifest(input) {
      const existing = manifests.get(input.manifestDigest);
      if (existing) {
        if (JSON.stringify(existing.manifestInput) !== JSON.stringify(input)) throw new Error('memory:manifest_conflict');
        log.push(`manifest:replay:${input.manifestDigest}`);
        return { status: 'replay', manifestId: input.manifestDigest };
      }
      const entry = { manifestInput: structuredClone(input), issued: null, aborted: null, disclosed: null };
      manifests.set(input.manifestDigest, entry);
      log.push(`manifest:recorded:${input.manifestDigest}`);
      return { status: 'recorded', manifestId: input.manifestDigest };
    },
    async recordDeckIssued(input) {
      const entry = manifestFor(input.manifestDigest);
      if (entry.aborted) throw new Error('memory:issue_after_abort');
      if (entry.issued) {
        if (entry.issued !== input.deckDigest) throw new Error('memory:issue_conflict');
        log.push(`deck:replay:${input.deckDigest}`);
        return { status: 'replay' };
      }
      entry.issued = input.deckDigest;
      log.push(`deck:issued:${input.deckDigest}`);
      return { status: 'issued' };
    },
    async recordAbort(input) {
      const entry = manifestFor(input.manifestDigest);
      if (entry.issued) throw new Error('memory:abort_after_issue');
      if (entry.aborted) {
        if (entry.aborted !== input.reasonCode) throw new Error('memory:abort_conflict');
        log.push(`abort:replay:${input.reasonCode}`);
        return { status: 'replay' };
      }
      entry.aborted = input.reasonCode;
      log.push(`abort:recorded:${input.reasonCode}`);
      return { status: 'aborted' };
    },
    async recordDisclosure(input) {
      const entry = manifestFor(input.manifestDigest);
      if (!entry.issued || entry.aborted) throw new Error('memory:disclosure_invalid_state');
      if (entry.issued !== input.deckDigest) throw new Error('memory:disclosure_deck_mismatch');
      if (entry.disclosed) {
        if (entry.disclosed !== input.disclosureDigest) throw new Error('memory:disclosure_conflict');
        log.push(`disclosure:replay:${input.disclosureDigest}`);
        return { status: 'replay' };
      }
      entry.disclosed = input.disclosureDigest;
      log.push(`disclosure:recorded:${input.disclosureDigest}`);
      return { status: 'disclosed' };
    },
  };
}

function fixture(handId = 'hand-1') {
  const context = { tenantId: 'tenant-a', tableId: 'table-1', handId, gameId: 'teen-patti' };
  return { context, ...commitments(context) };
}

const reveals = Object.freeze({
  serverSeed,
  participantSeeds: [
    { id: 'alice', seed: aliceSeed },
    { id: 'bob', seed: bobSeed },
  ],
});

test('manifest is durably recorded before seed reveals are consumed', async () => {
  const persistence = createMemoryPersistence();
  const setup = fixture();
  const expected = buildShuffleManifest(setup);
  const session = await beginAuditedShuffle({ canonicalDeck: buildTeenPattiDeck(), persistence, ...setup });

  assert.equal(session.manifest.manifestDigest, expected.manifestDigest);
  assert.equal(persistence.log.length, 1);
  assert.match(persistence.log[0], /^manifest:recorded:/);
  assert.equal(persistence.manifests.get(expected.manifestDigest).issued, null);
});

test('deck digest is persisted before an audited deck can be routed to a game consumer', async () => {
  const persistence = createMemoryPersistence();
  const session = await beginAuditedShuffle({ canonicalDeck: buildTeenPattiDeck(), persistence, ...fixture('hand-route') });
  const issued = await issueAuditedDeck(session, reveals);

  assert.equal(isAuditedDeck(issued), true);
  assert.match(persistence.log.at(-1), /^deck:issued:/);
  const consumed = routeAuditedDeck(issued, (deck, auditReceipt, publicReceipt) => {
    assert.match(persistence.log.at(-1), /^deck:issued:/);
    assert.equal(auditReceipt.status, 'issued');
    assert.equal(auditReceipt.deckDigest, publicReceipt.deckDigest);
    return deck.map((card) => card.id);
  });
  assert.equal(consumed.length, 52);
  assert.equal(new Set(consumed).size, 52);
});

test('forged or raw decks cannot enter the audited routing path', () => {
  assert.throws(() => routeAuditedDeck({ deck: buildTeenPattiDeck() }, () => true), /unaudited_deck_rejected/);
  assert.equal(isAuditedDeck({ deck: buildTeenPattiDeck() }), false);
});

test('post-commit abort is durable and terminal for deck issuance', async () => {
  const persistence = createMemoryPersistence();
  const session = await beginAuditedShuffle({ canonicalDeck: buildTeenPattiDeck(), persistence, ...fixture('hand-abort') });
  const aborted = await abortAuditedShuffle(session, { reasonCode: 'participant_reveal_timeout' });
  assert.equal(aborted.status, 'aborted');
  assert.match(persistence.log.at(-1), /^abort:recorded:/);
  await assert.rejects(() => issueAuditedDeck(session, reveals), /issue_after_abort/);
});

test('once a deck is issued the server cannot relabel the committed hand as aborted', async () => {
  const persistence = createMemoryPersistence();
  const session = await beginAuditedShuffle({ canonicalDeck: buildTeenPattiDeck(), persistence, ...fixture('hand-no-selective-abort') });
  await issueAuditedDeck(session, reveals);
  await assert.rejects(() => abortAuditedShuffle(session, { reasonCode: 'server_cancelled' }), /abort_after_issue/);
});

test('failed durable deck issuance fails closed and exposes no routable deck', async () => {
  const persistence = createMemoryPersistence();
  persistence.recordDeckIssued = async () => { throw new Error('database unavailable'); };
  const session = await beginAuditedShuffle({ canonicalDeck: buildTeenPattiDeck(), persistence, ...fixture('hand-db-fail') });
  await assert.rejects(() => issueAuditedDeck(session, reveals), /database unavailable/);
});

test('post-hand disclosure is verified before its digest is recorded', async () => {
  const persistence = createMemoryPersistence();
  const session = await beginAuditedShuffle({ canonicalDeck: buildTeenPattiDeck(), persistence, ...fixture('hand-disclose') });
  const issued = await issueAuditedDeck(session, reveals);
  const recorded = await recordShuffleDisclosure(session, issued.disclosure);
  assert.equal(recorded.status, 'disclosed');
  assert.equal(recorded.deckDigest, issued.publicReceipt.deckDigest);
  assert.match(recorded.disclosureDigest, /^[0-9a-f]{64}$/);
  assert.match(persistence.log.at(-1), /^disclosure:recorded:/);

  const tampered = structuredClone(issued.disclosure);
  [tampered.orderedCardIds[0], tampered.orderedCardIds[1]] = [tampered.orderedCardIds[1], tampered.orderedCardIds[0]];
  await assert.rejects(() => recordShuffleDisclosure(session, tampered), /order mismatch/);
});

test('exact deck issuance replay is idempotent and preserves the same digest', async () => {
  const persistence = createMemoryPersistence();
  const session = await beginAuditedShuffle({ canonicalDeck: buildTeenPattiDeck(), persistence, ...fixture('hand-replay') });
  const first = await issueAuditedDeck(session, reveals);
  const second = await issueAuditedDeck(session, reveals);
  assert.equal(first.publicReceipt.deckDigest, second.publicReceipt.deckDigest);
  assert.match(persistence.log.at(-1), /^deck:replay:/);
});
