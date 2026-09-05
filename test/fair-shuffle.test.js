import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeenPattiDeck } from '../src/game/teen-patti/cards.js';
import {
  FAIR_SHUFFLE_ALGORITHM,
  buildShuffleManifest,
  commitShuffleSeed,
  finalizeCommittedShuffle,
  generateShuffleSeed,
  verifyShuffleDisclosure,
} from '../src/game/fair-shuffle.js';

const context = Object.freeze({ tenantId: 'tenant-a', tableId: 'table-7', handId: 'hand-42', gameId: 'teen-patti' });
const serverSeed = '11'.repeat(32);
const aliceSeed = '22'.repeat(32);
const bobSeed = '33'.repeat(32);

function committedFixture(overrides = {}) {
  const ctx = overrides.context ?? context;
  const server = overrides.serverSeed ?? serverSeed;
  const participants = overrides.participantSeeds ?? [
    { id: 'alice', seed: aliceSeed },
    { id: 'bob', seed: bobSeed },
  ];
  const serverCommitment = commitShuffleSeed({ context: ctx, role: 'server', actorId: 'server', seed: server });
  const commitments = participants.map((entry) => ({
    id: entry.id,
    commitment: commitShuffleSeed({ context: ctx, role: 'participant', actorId: entry.id, seed: entry.seed }),
  }));
  const manifest = buildShuffleManifest({ context: ctx, serverCommitment, participants: commitments });
  return { manifest, serverSeed: server, participantSeeds: participants };
}

test('shuffle manifest is deterministic across participant commitment order', () => {
  const fixture = committedFixture();
  const reversed = buildShuffleManifest({
    context,
    serverCommitment: fixture.manifest.serverCommitment,
    participants: [...fixture.manifest.participants].reverse(),
  });
  assert.equal(reversed.manifestDigest, fixture.manifest.manifestDigest);
  assert.deepEqual(reversed.participants.map((entry) => entry.id), ['alice', 'bob']);
});

test('committed shuffle produces an exact permutation and disclosure reconstructs it byte-for-byte by card id', () => {
  const fixture = committedFixture();
  const canonical = buildTeenPattiDeck();
  const result = finalizeCommittedShuffle({ canonicalDeck: canonical, ...fixture });
  assert.equal(result.publicReceipt.algorithm, FAIR_SHUFFLE_ALGORITHM);
  assert.equal(result.deck.length, canonical.length);
  assert.equal(new Set(result.deck.map((card) => card.id)).size, canonical.length);
  assert.notDeepEqual(result.deck.map((card) => card.id), canonical.map((card) => card.id));
  assert.equal('serverSeed' in result.publicReceipt, false);
  assert.equal('participantSeeds' in result.publicReceipt, false);
  const verified = verifyShuffleDisclosure(canonical, result.disclosure);
  assert.equal(verified.valid, true);
  assert.deepEqual(verified.deck.map((card) => card.id), result.deck.map((card) => card.id));
});

test('tampered server or participant reveal fails closed against the precommitted manifest', () => {
  const canonical = buildTeenPattiDeck();
  const fixture = committedFixture();
  assert.throws(() => finalizeCommittedShuffle({ canonicalDeck: canonical, ...fixture, serverSeed: '44'.repeat(32) }), /server shuffle reveal/);
  const changedParticipant = fixture.participantSeeds.map((entry) => entry.id === 'alice' ? { ...entry, seed: '55'.repeat(32) } : entry);
  assert.throws(() => finalizeCommittedShuffle({ canonicalDeck: canonical, manifest: fixture.manifest, serverSeed, participantSeeds: changedParticipant }), /commitment mismatch/);
});

test('commitments are hand-context bound and cannot be replayed across table or hand boundaries', () => {
  const fixture = committedFixture();
  const changedContext = { ...context, handId: 'hand-43' };
  const replayedManifest = buildShuffleManifest({
    context: changedContext,
    serverCommitment: fixture.manifest.serverCommitment,
    participants: fixture.manifest.participants,
  });
  assert.throws(() => finalizeCommittedShuffle({
    canonicalDeck: buildTeenPattiDeck(),
    manifest: replayedManifest,
    serverSeed,
    participantSeeds: fixture.participantSeeds,
  }), /server shuffle reveal/);
});

test('changing one participant seed changes the final shuffled order while server seed remains fixed', () => {
  const canonical = buildTeenPattiDeck();
  const first = finalizeCommittedShuffle({ canonicalDeck: canonical, ...committedFixture() });
  const secondFixture = committedFixture({ participantSeeds: [
    { id: 'alice', seed: '77'.repeat(32) },
    { id: 'bob', seed: bobSeed },
  ] });
  const second = finalizeCommittedShuffle({ canonicalDeck: canonical, ...secondFixture });
  assert.notEqual(first.publicReceipt.deckDigest, second.publicReceipt.deckDigest);
  assert.notDeepEqual(first.deck.map((card) => card.id), second.deck.map((card) => card.id));
});

test('disclosure tampering in deck order or digest is detected', () => {
  const canonical = buildTeenPattiDeck();
  const result = finalizeCommittedShuffle({ canonicalDeck: canonical, ...committedFixture() });
  const changedOrder = structuredClone(result.disclosure);
  [changedOrder.orderedCardIds[0], changedOrder.orderedCardIds[1]] = [changedOrder.orderedCardIds[1], changedOrder.orderedCardIds[0]];
  assert.throws(() => verifyShuffleDisclosure(canonical, changedOrder), /order mismatch/);
  const changedDigest = structuredClone(result.disclosure);
  changedDigest.deckDigest = '00'.repeat(32);
  assert.throws(() => verifyShuffleDisclosure(canonical, changedDigest), /deck digest mismatch/);
});

test('2,000 deterministic committed shuffles preserve exact deck custody and replayability', () => {
  const canonical = buildTeenPattiDeck();
  for (let i = 0; i < 2_000; i += 1) {
    const suffix = i.toString(16).padStart(8, '0');
    const ctx = { tenantId: 'tenant-load', tableId: `table-${i % 17}`, handId: `hand-${i}`, gameId: 'teen-patti' };
    const fixture = committedFixture({
      context: ctx,
      serverSeed: `${suffix}${'a'.repeat(56)}`,
      participantSeeds: [
        { id: 'alice', seed: `${suffix}${'b'.repeat(56)}` },
        { id: 'bob', seed: `${suffix}${'c'.repeat(56)}` },
      ],
    });
    const result = finalizeCommittedShuffle({ canonicalDeck: canonical, ...fixture });
    assert.equal(new Set(result.deck.map((card) => card.id)).size, 52);
    const verified = verifyShuffleDisclosure(canonical, result.disclosure);
    assert.equal(verified.deckDigest, result.publicReceipt.deckDigest);
  }
});

test('runtime seed generation emits 32-byte lowercase hexadecimal entropy', () => {
  const a = generateShuffleSeed();
  const b = generateShuffleSeed();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});
